import { Base } from "./base";

const respStart = "(?<=\\r\\n|^)";
const respEnd = "(?=\\r\\n)";

interface InterfaceParser {
  matches: RegExpMatchArray[];
  blobs: Map<string, string>;
}

export class Protocol {
  private _buffer: string;
  constructor() {
    this._buffer = "";
  }
  public write(data: Buffer) {
    this._buffer += data.toString();
  }
  public parse() {
    const parsed = ProtocolParser.parse(this._buffer);
    this._buffer = "";
    return ProtocolParser.collect(parsed);
  }
  public encode(...parameters: Array<string | number>): string {
    const length = parameters.length;
    let parameter: any;

    let request = `*${length}\r\n`;
    for (let i = 0; i < length; i++) {
      parameter = parameters[i];
      if (typeof parameter === "string") {
        request += `$${Buffer.byteLength(parameter)}\r\n${parameter}\r\n`;
      } else if (typeof parameter === "number") {
        parameter = parameter.toString();
        request += `$${Buffer.byteLength(parameter)}\r\n${parameter}\r\n`;
      } else {
        throw new Error("encode ags err");
      }
    }
    return request;
  }
}

export class RedisProtocolError extends Error {
  constructor(name: string, message: string) {
    super();
    this.name = name;
    this.message = message;
  }
}

class ProtocolParser {
  public static parse(raw: string): InterfaceParser {
    let masterRegex = [
      "\\+(?<simple>.+?)",
      "(?<blobString>\\$blobRef_\\d+)", // Note: this matches our replaced Blob-Ref
      "(?<verbatimString>\\=blobRef_\\d+)", // Note: this matches our replaced Blob-Ref
      "\\-(?<error_code>.+?) (?<error_msg>.+?)",
      "(?<blobError>\\!blobRef_\\d+)", // Note: this matches our replaced Blob-Ref
      "\\:(?<int>-?\\d+)",
      "\\((?<bigInt>-?\\d+)",
      ",(?<double>\\d+\.?\\d*)",
      ",(?<inf>-?inf)",
      "#(?<boolean>t|f)",
      "\\*(?<array_n>\\d+)(?<array>)",
      "%(?<map_n>\\d+)(?<map>)",
      "~(?<set_n>\\d+)(?<set>)",
      "_(?<null>)",
      "(\\$|\\*)(?<null_string>-1)",
    ].join("|");

    // Preprocess blobs since they can include <CR><LF>
    let blobs = ProtocolParser.extractBlobs(raw, "$");
    blobs = ProtocolParser.extractBlobs(blobs.buffer, "!", blobs.output);
    blobs = ProtocolParser.extractBlobs(blobs.buffer, "=", blobs.output);

    masterRegex = `${respStart}(?:${masterRegex})${respEnd}`;
    const matches = Array.from(blobs.buffer.matchAll(new RegExp(masterRegex, "g")));
    return {
      matches,
      blobs: blobs.output,
    };
  }
  public static collect(parsed: InterfaceParser): any[] {
    const output = new Array();
    do {
      ProtocolParser.aggregateMessages(parsed, output);
    } while (parsed.matches.length > 0);

    return output;
  }
  private static extractBlobs(
    raw: string,
    blobByte: string,
    blobs: Map<string, string>= new Map()
  ): {output: Map<string, string>, buffer: string} {
    let buffer = raw;
    let refInx = 0;
    // This expression matches all `\r\n$N\r\n` where `N` is digit(s) to find all blob specifications
    const blobSizeRegex = `${respStart}\\${blobByte}(?<byteCount>\\d+)${respEnd}`;
    const blobMatches = Array.from(buffer.matchAll(new RegExp(blobSizeRegex, "g")));
    for (const blob of blobMatches) {
      if (blob.groups !== undefined) {
        // this expression looks for something like `$N\r\n1..N\r\n` (where N = byteCount characters to match)
        const fullBlobRegex = `${respStart}\\${blobByte}${blob.groups.byteCount}\\r\\n(?<blob>.*)${respEnd}`;
        const blobMatch = buffer.match(new RegExp(fullBlobRegex, "su"));

        if (blobMatch !== null && blobMatch.groups !== undefined) {
          const stringLength = parseInt(blob.groups.byteCount, 10);
          const bulkString = Buffer.from(blobMatch.groups.blob).slice(0, stringLength);

          if (bulkString.length === stringLength) {
            const key = `${blobByte}blobRef_${refInx}`;
            refInx++;
            blobs.set(key, bulkString.toString());
            const extractedBlobRegex = `${respStart}\\${blobByte}${blob.groups.byteCount}\\r\\n${blobs.get(key)}`;
            buffer = buffer.replace(new RegExp(extractedBlobRegex, "s"), key);
          }
        }
      }
    }
    return {
      output: blobs,
      buffer,
    };
  }
  private static aggregateMessages(parsed: InterfaceParser, output: any[]) {
    const current = parsed.matches.shift();
    if (current !== undefined && current.groups !== undefined) {
      if ("array_n" in current.groups && current.groups.array_n !== undefined) {
        const array_n = parseInt(current.groups.array_n, 10);
        const arrayResp = new Array();
        for (let inx = 0; inx < array_n; inx++) {
          ProtocolParser.aggregateMessages(parsed, arrayResp);
        }

        if (arrayResp.length === array_n) {
          output.push(arrayResp);
        }
      } else if ("map_n" in current.groups && current.groups.map_n !== undefined) {
        const map_n = parseInt(current.groups.map_n, 10);
        const mapResp = new Map();
        for (let inx = 0; inx < map_n; inx++) {
          const tmp = new Array();
          ProtocolParser.aggregateMessages(parsed, tmp);
          const field = tmp.shift();
          ProtocolParser.aggregateMessages(parsed, tmp);
          const value = tmp.shift();
          mapResp.set(field, value);
        }

        if (mapResp.size === map_n) {
          output.push(mapResp);
        }
      } else if ("set_n" in current.groups && current.groups.set_n !== undefined) {
        const set_n = parseInt(current.groups.set_n, 10);
        const setResp = new Set();
        let collected = 0;
        for (let inx = 0; inx < set_n; inx++) {
          const tmp = new Array();
          ProtocolParser.aggregateMessages(parsed, tmp);
          setResp.add(tmp.shift());
          collected++;
        }

        if (collected === set_n) {
          output.push(setResp);
        }
      } else if ("simple" in current.groups && current.groups.simple !== undefined) {
        output.push(current.groups.simple);
      } else if ("blobString" in current.groups && current.groups.blobString !== undefined) {
        output.push(parsed.blobs.get(current.groups.blobString));
      } else if ("verbatimString" in current.groups && current.groups.verbatimString !== undefined) {
        // TODO: We could have some sort of escaped Object which can handle txt vs mkd
        output.push(parsed.blobs.get(current.groups.verbatimString)?.slice(4, ));
      } else if ("error_code" in current.groups && current.groups.error_code !== undefined) {
        output.push(new RedisProtocolError(current.groups.error_code, current.groups.error_msg));
      } else if ("blobError" in current.groups && current.groups.blobError !== undefined) {
        const errorBlob = parsed.blobs.get(current.groups.blobError) || "";
        const errorParts = errorBlob.match(/^(?<code>.+?) (?<msg>.+?)$/s);
        if (errorParts?.groups !== undefined) {
          output.push(new RedisProtocolError(errorParts.groups.code, errorParts.groups.msg));
        }
      } else if ("int" in current.groups && current.groups.int !== undefined) {
        output.push(parseInt(current.groups.int, 10));
      } else if ("bigInt" in current.groups && current.groups.bigInt !== undefined) {
        output.push(BigInt(current.groups.bigInt));
      } else if ("double" in current.groups && current.groups.double !== undefined) {
        output.push(parseFloat(current.groups.double));
      } else if ("inf" in current.groups && current.groups.inf !== undefined) {
        if (current.groups.inf[0] === "-") {
          output.push(-Infinity);
        } else {
          output.push(Infinity);
        }
      } else if ("boolean" in current.groups && current.groups.boolean !== undefined) {
        if (current.groups.boolean === "t") {
          output.push(true);
        } else if (current.groups.boolean === "f") {
          output.push(false);
        }
      } else if ("null" in current.groups && current.groups.null !== undefined) {
        output.push(null);
      } else if ("null_string" in current.groups && current.groups.null_string !== undefined) {
        output.push(null);
      }
    }
  }
}
