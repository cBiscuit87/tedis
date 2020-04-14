import { Tedis, TedisPool } from "../../src/main";
import { config } from "../../tools/index";

const Pool = new TedisPool(config);
let Scan: Tedis;

beforeAll(async () => {
  Scan = await Pool.getTedis();
});

beforeEach(async () => {
  await Scan.command("SELECT", 6);
  await Scan.command("FLUSHDB");
});

afterAll(async () => {
  await Scan.command("FLUSHDB");
  Scan.close();
});

describe("Redis Scan", () => {
  it(`should scan`, async () => {
    await Scan.rpush("listA", "something");
    await Scan.rpush("listB", "something else");
    const result = await Scan.command("SCAN", 0);
    expect(result[0]).toEqual("0");
    expect(result[1].sort()).toEqual(["listA", "listB"].sort());
  });
});
