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
    await Scan.rpush("a", 1);
    await Scan.rpush("b", 2);
    expect(await Scan.command("SCAN", 0)).toMatchObject(["0", ["a", "b"]]);
  });
});
