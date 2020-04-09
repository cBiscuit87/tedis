import { DESTRUCTION } from "dns";
import { Protocol, RedisProtocolError } from "../../src/core/protocol";

let protocol: Protocol;
let data: any;

interface Encode {
  title: string;
  input: Array<string | number>;
  output: string;
}

beforeEach(async () => {
  protocol = new Protocol();
});

describe("parse", () => {
  // Tests based on specification https://redis.io/topics/protocol
  // Adding RESP3 Support: https://github.com/antirez/RESP3/blob/master/spec.md

  // #region Simple Types
  describe("RESP3 Blob (Bulk) Strings", () => {
    /**
     * Bulk Strings are encoded in the following way:
     *  - A "$" byte followed by the number of bytes composing the string
     *    (a prefixed length), terminated by CRLF.
     *  - The actual string data.
     *  - A final CRLF.
     *
     * RESP Bulk Strings can also be used in order to signal non-existence of a
     * value using a special format that is used to represent a Null value. In
     * this special format the length is -1, and there is no data ... This is
     * called a **Null Bulk String**. The client library API should not return
     * an empty string, but a nil object, when the server replies with a Null
     * Bulk String. For example a Ruby library should return 'nil' while a C
     * library should return NULL (or set a special flag in the reply object),
     * and so forth.
     */
    it(`$6 foobar`, () => {
      protocol.write(Buffer.from(`$6\r\nfoobar\r\n`));
      data = protocol.parse();
      expect(data).toEqual(["foobar"]);
    });
    it(`$0`, () => {
      protocol.write(Buffer.from(`$0\r\n\r\n`));
      data = protocol.parse();
      expect(data).toEqual([""]);
    });
    it(`$-1`, () => {
      protocol.write(Buffer.from(`$-1\r\n`));
      data = protocol.parse();
      expect(data).toEqual([null]);
    });
    it(`$ includes CRLF`, () => {
      protocol.write(Buffer.from(`$13\r\nhello\r\nworld!\r\n`));
      data = protocol.parse();
      expect(data).toEqual(["hello\r\nworld!"]);
    });
    it(`$ includes LF and tab`, () => {
      protocol.write(Buffer.from(`$14\r\nhello\n\t\tworld!\r\n`));
      data = protocol.parse();
      expect(data).toEqual(["hello\n\t\tworld!"]);
    });
    it(`$ incomplete`, () => {
      protocol.write(Buffer.from(`$3\r\nhe`));
      data = protocol.parse();
      expect(data).toEqual([]);
    });
  });

  describe("RESP3 Simple Strings", () => {
    /**
     * When Redis replies with a Simple String, a client library should return
     * to the caller a string composed of the first character after the '+' up
     * to the end of the string, excluding the final CRLF bytes.
     */
    it(`+OK`, () => {
      protocol.write(Buffer.from(`+OK\r\n`));
      data = protocol.parse();
      expect(data).toEqual(["OK"]);
    });
    it(`+Another Simple String`, () => {
      protocol.write(Buffer.from(`+Another Simple String\r\n`));
      data = protocol.parse();
      expect(data).toEqual(["Another Simple String"]);
    });
  });

  describe("RESP3 Simple Errors", () => {
    /**
     * ... errors are treated by clients as exceptions, and the string that
     * composes the Error type is the error message itself.
     *
     * The first word after the "-", up to the first space or newline,
     * represents the kind of error returned.
     */
    it(`-Error message`, () => {
      protocol.write(Buffer.from(`-Error message\r\n`));
      data = protocol.parse();
      expect(data).toEqual([new RedisProtocolError("Error", "message")]);
    });
    it(`-ERR unknown command 'foobar'`, () => {
      protocol.write(Buffer.from(`-ERR unknown command 'foobar'\r\n`));
      data = protocol.parse();
      expect(data).toEqual([new RedisProtocolError("ERR", "unknown command 'foobar'")]);
    });
    it(`-WRONGTYPE Operation against a key holding the wrong kind of value`, () => {
      protocol.write(Buffer.from(`-WRONGTYPE Operation against a key holding the wrong kind of value\r\n`));
      data = protocol.parse();
      expect(data).toEqual([new RedisProtocolError("WRONGTYPE", "Operation against a key holding the wrong kind of value")]);
    });
  });

  describe("RESP3 Numer (Integers)", () => {
    /**
     * This type is just a CRLF terminated string representing an integer,
     * prefixed by a ":" byte. For example ":0\r\n", or ":1000\r\n" are integer
     * replies.
     *
     * ... the returned integer is guaranteed to be in the range of a signed 64
     * bit integer.
     */
    it(`:0`, () => {
      protocol.write(Buffer.from(`:0\r\n`));
      data = protocol.parse();
      expect(data).toEqual([0]);
    });
    it(`:1000`, () => {
      protocol.write(Buffer.from(`:1000\r\n`));
      data = protocol.parse();
      expect(data).toEqual([1000]);
    });
    it(`:-1`, () => {
      protocol.write(Buffer.from(`:-1\r\n`));
      data = protocol.parse();
      expect(data).toEqual([-1]);
    });
    it(`:-2147483648`, () => {
      protocol.write(Buffer.from(`:-2147483648\r\n`));
      data = protocol.parse();
      expect(data).toEqual([-2147483648]);
    });
    it(`:2147483647`, () => {
      protocol.write(Buffer.from(`:2147483647\r\n`));
      data = protocol.parse();
      expect(data).toEqual([2147483647]);
    });
  });

  describe("RESP3 Null", () => {
    /**
     * The null type is encoded just as _\r\n, which is just the underscore
     * character followed by the CR and LF characters.
     */
    it(`_`, () => {
      protocol.write(Buffer.from(`_\r\n`));
      data = protocol.parse();
      expect(data).toEqual([null]);
    });
  });

  describe("RESP3 Double", () => {
    /**
     * The general form is ,<floating-point-number>\r\n.
     *
     * To just start with . assuming an initial zero is invalid. Exponential format is invalid.
     */
    it(`,1.23`, () => {
      protocol.write(Buffer.from(`,1.23\r\n`));
      data = protocol.parse();
      expect(data).toEqual([1.23]);
    });

    it(`,10`, () => {
      protocol.write(Buffer.from(`,10\r\n`));
      data = protocol.parse();
      expect(data).toEqual([10]);
    });

    it(`,inf`, () => {
      protocol.write(Buffer.from(`,inf\r\n`));
      data = protocol.parse();
      expect(data).toEqual([Infinity]);
    });

    it(`,-inf`, () => {
      protocol.write(Buffer.from(`,-inf\r\n`));
      data = protocol.parse();
      expect(data).toEqual([-Infinity]);
    });
  });

  describe("RESP3 Boolean", () => {
    /**
     * True and false values are just represented using #t\r\n and #f\r\n sequences.
     */
    it(`#t`, () => {
      protocol.write(Buffer.from(`#t\r\n`));
      data = protocol.parse();
      expect(data).toEqual([true]);
    });

    it(`#f`, () => {
      protocol.write(Buffer.from(`#f\r\n`));
      data = protocol.parse();
      expect(data).toEqual([false]);
    });
    it(`$ incomplete`, () => {
      protocol.write(Buffer.from(`$9\r\n世界！\r\n`));
      data = protocol.parse();
      expect(data).toEqual(["世界！"]);
    });

  });

  describe("RESP3 Blob Errors", () => {
    /**
     * The general form is !<length>\r\n<bytes>\r\n.
     */
    it(`!21 SYNTAX invalid syntax`, () => {
      protocol.write(Buffer.from(`!21\r\nSYNTAX invalid syntax\r\n`));
      data = protocol.parse();
      expect(data).toEqual([new RedisProtocolError("SYNTAX", "invalid syntax")]);
    });
    it(`!7 FOO bar`, () => {
      protocol.write(Buffer.from(`!7\r\nFOO bar\r\n`));
      data = protocol.parse();
      expect(data).toEqual([new RedisProtocolError("FOO", "bar")]);
    });
    it(`! includes CRLF`, () => {
      protocol.write(Buffer.from(`!20\r\nHELLO \r\nSome\n\tworld!\r\n`));
      data = protocol.parse();
      expect(data).toEqual([new RedisProtocolError("HELLO", "\r\nSome\n\tworld!")]);
    });
  });

  describe("RESP3 Verbatim Strings", () => {
    /**
     * This is exactly like the Blob string type, but the initial byte is = instead of $.
     * Moreover the first three bytes provide information about the format of the following string,
     * which can be txt for plain text, or mkd for markdown. The fourth byte is always :. Then the
     * real string follows.
     *
     * Normal client libraries may ignore completely the difference between this type and the String
     * type, and return a string in both cases.
     */
    it(`=15 txt:Some string`, () => {
      protocol.write(Buffer.from(`=15\r\ntxt:Some string\r\n`));
      data = protocol.parse();
      expect(data).toEqual(["Some string"]);
    });
    it(`= includes CRLF`, () => {
      protocol.write(Buffer.from(`=19\r\nmkd:# hello\r\nworld!\r\n`));
      data = protocol.parse();
      expect(data).toEqual(["# hello\r\nworld!"]);
    });
  });

  describe("RESP3 Big Number", () => {
    /**
     * The general form is (<big number>\r\n
     */
    it(`(0`, () => {
      protocol.write(Buffer.from(`(0\r\n`));
      data = protocol.parse();
      expect(data).toEqual([BigInt(0)]);
    });
    it(`(1000`, () => {
      protocol.write(Buffer.from(`(1000\r\n`));
      data = protocol.parse();
      expect(data).toEqual([BigInt(1000)]);
    });
    it(`(-1`, () => {
      protocol.write(Buffer.from(`(-1\r\n`));
      data = protocol.parse();
      expect(data).toEqual([BigInt(-1)]);
    });
    it(`(-3492890328409238509324850943850943825024385`, () => {
      protocol.write(Buffer.from(`(-3492890328409238509324850943850943825024385\r\n`));
      data = protocol.parse();
      expect(data).toEqual([BigInt("-3492890328409238509324850943850943825024385")]);
    });
    it(`(3492890328409238509324850943850943825024385`, () => {
      protocol.write(Buffer.from(`(3492890328409238509324850943850943825024385\r\n`));
      data = protocol.parse();
      expect(data).toEqual([BigInt("3492890328409238509324850943850943825024385")]);
    });
  });
  // #endregion Simple Types

  // #region Aggregate Types
  describe("RESP3 Arrays", () => {
    /**
     * RESP Arrays are sent using the following format:
     *  - A '*' character as the first byte, followed by the number of elements in the array as a decimal number,
     *    followed by CRLF.
     *  - An additional RESP type for every element of the Array.
     *
     * ... A client library API should return a null object and not an empty Array when Redis replies with a Null
     *     Array. This is necessary to distinguish between an empty list and a different condition (for instance the
     *     timeout condition of the BLPOP command).
     */
    it(`*0 [] Empty Array`, () => {
      protocol.write(
        Buffer.from(`*0\r\n`)
      );
      data = protocol.parse();
      expect(data).toEqual([[]]);
    });
    it(`*2 [foo bar]`, () => {
      protocol.write(
        Buffer.from(`*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n`)
      );
      data = protocol.parse();
      expect(data).toEqual([["foo", "bar"]]);
    });
    it(`*3 [1 2 3]`, () => {
      protocol.write(
        Buffer.from(`*3\r\n:1\r\n:2\r\n:3\r\n`)
      );
      data = protocol.parse();
      expect(data).toEqual([[1, 2, 3]]);
    });
    it(`*5 [1 2 3 4 foobar]`, () => {
      protocol.write(
        Buffer.from(`*5\r\n:1\r\n:2\r\n:3\r\n:4\r\n$6\r\nfoobar\r\n`)
      );
      data = protocol.parse();
      expect(data).toEqual([[1, 2, 3, 4, "foobar"]]);
    });
    it(`*-1 null`, () => {
      protocol.write(
        Buffer.from(`*-1\r\n`)
      );
      data = protocol.parse();
      expect(data).toEqual([null]);
    });
    it(`*3 foo null bar`, () => {
      protocol.write(
        Buffer.from(`*3\r\n$3\r\nfoo\r\n$-1\r\n$3\r\nbar\r\n`)
      );
      data = protocol.parse();
      expect(data).toEqual([["foo", null, "bar"]]);
    });
    it(`* array`, () => {
      protocol.write(
        Buffer.from(`*3\r\n$1\r\n1\r\n$5\r\nhello\r\n$5\r\ntedis\r\n`)
      );
      data = protocol.parse();
      expect(data).toEqual([["1", "hello", "tedis"]]);
    });
    it(`* incomplete`, () => {
      protocol.write(Buffer.from(`*3\r\n$1\r\nhello`));
      data = protocol.parse();
      expect(data).toEqual([]);
    });
  });

  describe("RESP3 Map", () => {
    /**
     * Maps represent a sequence of field-value items, basically what we could call a
     * dictionary data structure, or in other terms, an hash.
     */
    it(`%{first:1,second:2}`, () => {
      protocol.write(Buffer.from(`%2\r\n+first\r\n:1\r\n+second\r\n:2\r\n`));
      data = protocol.parse();
      expect(data).toMatchObject([new Map(Object.entries({first: 1, second: 2}))]);
    });
    it(`% Complex arrays and blobs`, () => {
      protocol.write(Buffer.from(`%3\r\n+first\r\n*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n+second\r\n*3\r\n:1\r\n1\r\n$5\r\nhello\r\n$5\r\ntedis\r\n+third\r\n=19\r\nmkd:# hello\r\nworld!\r\n`));
      data = protocol.parse();
      expect(data).toMatchObject([new Map(Object.entries({first: ["foo", "bar"], second: [1, "hello", "tedis"], third: "# hello\r\nworld!"}))]);
    });
  });

  describe("RESP3 Sets", () => {
    /**
     * Sets are exactly like the Array type, but the first byte is ~ instead of *
     *
     * However they are semantically different because the represented items are unordered collections
     * of elements, so the client library should return a type that, while not necessarily ordered, has
     * a test for existence operation running in constant or logarithmic time.
     */
    it(`~0 [] Empty Set`, () => {
      protocol.write(
        Buffer.from(`~0\r\n`)
      );
      data = protocol.parse();
      expect(data).toEqual([new Set()]);
    });
    it(`~2 [foo bar]`, () => {
      protocol.write(
        Buffer.from(`~2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n`)
      );
      data = protocol.parse();
      expect(data).toEqual([new Set(["foo", "bar"])]);
    });
    it(`~3 [1 2 3]`, () => {
      protocol.write(
        Buffer.from(`~3\r\n:1\r\n:2\r\n:3\r\n`)
      );
      data = protocol.parse();
      expect(data).toEqual([new Set([1, 2, 3])]);
    });
    it(`~5 [1 2 3 4 foobar]`, () => {
      protocol.write(
        Buffer.from(`~5\r\n:1\r\n:2\r\n:3\r\n:4\r\n$6\r\nfoobar\r\n`)
      );
      data = protocol.parse();
      expect(data).toEqual([new Set([1, 2, 3, 4, "foobar"])]);
    });
    it(`~3 foo null bar`, () => {
      protocol.write(
        Buffer.from(`~3\r\n$3\r\nfoo\r\n_\r\n$3\r\nbar\r\n`)
      );
      data = protocol.parse();
      expect(data).toEqual([new Set(["foo", null, "bar"])]);
    });
    it(`~5 orange apple true 100 999`, () => {
      protocol.write(
        Buffer.from(`~5\r\n+orange\r\n+apple\r\n#t\r\n:100\r\n:999\r\n`)
      );
      data = protocol.parse();
      expect(data).toEqual([new Set(["orange", "apple", true, 100, 999])]);
    });
    it(`~3 orange orange`, () => {
      protocol.write(
        Buffer.from(`~3\r\n+orange\r\n+orange\r\n+apple\r\n`)
      );
      data = protocol.parse();
      expect(data).toEqual([new Set(["orange", "apple"])]);
    });
  });
  // #endregion Aggregate Types
});

describe("encode", () => {
  const mock: Encode[] = [
    {
      title: "set",
      input: ["SET", "string1", "124235"],
      output: `*3\r\n$3\r\nSET\r\n$7\r\nstring1\r\n$6\r\n124235\r\n`,
    },
    {
      title: "get",
      input: ["GET", "string1"],
      output: `*2\r\n$3\r\nGET\r\n$7\r\nstring1\r\n`,
    },
    {
      title: "del",
      input: ["DEL", "string1"],
      output: `*2\r\n$3\r\nDEL\r\n$7\r\nstring1\r\n`,
    },
  ];
  mock.forEach((item) => {
    it(item.title, () => {
      expect(protocol.encode(...item.input)).toBe(item.output);
    });
  });
  it(`error parameter`, () => {
    expect(() => {
      try {
        protocol.encode([1, 2, 3] as any);
      } catch (error) {
        throw new Error(error);
      }
    }).toThrow(Error);
  });
});
