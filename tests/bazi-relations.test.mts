import test from "node:test";
import assert from "node:assert/strict";
import {
  GAN, ZHI, GAN_ELEMENT, ZHI_ELEMENT, ZHI_HIDE_GAN, HIDE_WEIGHTS,
  changShengOf, ganIsYang, zhiIsYang, SHENG, KE,
} from "../src/lib/bazi/constants.ts";
import {
  shiShenOf, SHI_SHEN_GROUP, SHI_SHEN_MEANING,
  branchRelations, tripleHarmonies, stemHarmonies, elementRelation,
} from "../src/lib/bazi/relations.ts";

// ── 基础表 ───────────────────────────────────────────────

test("十天干十二地支齐全且无重复", () => {
  assert.equal(GAN.length, 10);
  assert.equal(ZHI.length, 12);
  assert.equal(new Set(GAN).size, 10);
  assert.equal(new Set(ZHI).size, 12);
});

test("干支的五行归属", () => {
  assert.equal(GAN_ELEMENT["甲"], "木");
  assert.equal(GAN_ELEMENT["癸"], "水");
  assert.equal(ZHI_ELEMENT["子"], "水");
  assert.equal(ZHI_ELEMENT["戌"], "土");
});

test("阴阳：甲丙戊庚壬为阳，子寅辰午申戌为阳", () => {
  for (const g of ["甲", "丙", "戊", "庚", "壬"]) assert.equal(ganIsYang(g), true, g);
  for (const g of ["乙", "丁", "己", "辛", "癸"]) assert.equal(ganIsYang(g), false, g);
  for (const z of ["子", "寅", "辰", "午", "申", "戌"]) assert.equal(zhiIsYang(z), true, z);
  for (const z of ["丑", "卯", "巳", "未", "酉", "亥"]) assert.equal(zhiIsYang(z), false, z);
});

test("五行生克", () => {
  assert.equal(SHENG["木"], "火");
  assert.equal(SHENG["水"], "木");
  assert.equal(KE["木"], "土");
  assert.equal(KE["金"], "木");
  // 相生的链条走五步回到自身
  let e = "木" as keyof typeof SHENG;
  for (let i = 0; i < 5; i++) e = SHENG[e];
  assert.equal(e, "木");
});

test("每个地支的藏干权重与 table 一一对应", () => {
  for (const z of ZHI) {
    const hides = ZHI_HIDE_GAN[z];
    assert.ok(hides && hides.length > 0, `${z} 没有藏干`);
    assert.ok(hides.length <= HIDE_WEIGHTS.length, `${z} 的藏干比权重表还长`);
    for (const g of hides) {
      assert.ok(GAN.includes(g as never), `${z} 藏了不存在的天干 ${g}`);
    }
  }
  // 子午卯酉是四正，只藏本气
  for (const z of ["子", "卯", "酉"]) assert.equal(ZHI_HIDE_GAN[z].length, 1, z);
});

// ── 十二长生 ─────────────────────────────────────────────

test("阳干顺行：甲长生在亥，顺数到寅为临官、卯为帝旺", () => {
  assert.equal(changShengOf("甲", "亥"), "长生");
  assert.equal(changShengOf("甲", "子"), "沐浴");
  assert.equal(changShengOf("甲", "丑"), "冠带");
  assert.equal(changShengOf("甲", "寅"), "临官");
  assert.equal(changShengOf("甲", "卯"), "帝旺");
});

test("阴干逆行：乙长生在午，逆数到巳为沐浴、卯为临官", () => {
  assert.equal(changShengOf("乙", "午"), "长生");
  assert.equal(changShengOf("乙", "巳"), "沐浴");
  assert.equal(changShengOf("乙", "辰"), "冠带");
  assert.equal(changShengOf("乙", "卯"), "临官");
  assert.equal(changShengOf("乙", "寅"), "帝旺");
});

test("十二长生走满一轮回到起点", () => {
  for (const g of GAN) {
    const start = changShengOf(g, "子")!;
    assert.ok(start, `${g} 在子上取不到长生状态`);
    let seen = 0;
    for (const z of ZHI) if (changShengOf(g, z) === "长生") seen++;
    assert.equal(seen, 1, `${g} 的长生位出现了 ${seen} 次，应当恰好一次`);
  }
});

// ── 十神 ─────────────────────────────────────────────────

test("日主甲木对十天干的十神", () => {
  const want: Record<string, string> = {
    甲: "比肩", 乙: "劫财",
    丙: "食神", 丁: "伤官",
    戊: "偏财", 己: "正财",
    庚: "七杀", 辛: "正官",
    壬: "偏印", 癸: "正印",
  };
  for (const [g, s] of Object.entries(want)) {
    assert.equal(shiShenOf("甲", g), s, `甲见${g}`);
  }
});

test("日主癸水对十天干的十神（阴阳全反，用来验同异阴阳的分支）", () => {
  const want: Record<string, string> = {
    癸: "比肩", 壬: "劫财",
    甲: "伤官", 乙: "食神",
    丙: "正财", 丁: "偏财",
    戊: "正官", 己: "七杀",
    庚: "正印", 辛: "偏印",
  };
  for (const [g, s] of Object.entries(want)) {
    assert.equal(shiShenOf("癸", g), s, `癸见${g}`);
  }
});

test("每个日主的十神恰好覆盖十种，不多不少", () => {
  for (const day of GAN) {
    const got = new Set(GAN.map((g) => shiShenOf(day, g)));
    assert.equal(got.size, 10, `日主${day}只推出了 ${got.size} 种十神`);
  }
});

test("十神归组：比劫/食伤/财/官杀/印 各两个", () => {
  const byGroup: Record<string, number> = {};
  for (const s of Object.keys(SHI_SHEN_GROUP) as (keyof typeof SHI_SHEN_GROUP)[]) {
    byGroup[SHI_SHEN_GROUP[s]] = (byGroup[SHI_SHEN_GROUP[s]] ?? 0) + 1;
  }
  assert.deepEqual(byGroup, { 比劫: 2, 食伤: 2, 财: 2, 官杀: 2, 印: 2 });
});

test("每个十神都有一句人话解释，且不含未替换的占位", () => {
  for (const s of Object.keys(SHI_SHEN_MEANING) as (keyof typeof SHI_SHEN_MEANING)[]) {
    const m = SHI_SHEN_MEANING[s];
    assert.ok(m.keyword.length > 0, `${s} 缺 keyword`);
    assert.ok(m.plain.length >= 12, `${s} 的解释太短，读者得不到信息`);
    assert.doesNotMatch(m.plain, /TODO|待补|XXX/);
  }
});

// ── 合冲 ─────────────────────────────────────────────────

test("六合：子丑合土，午未合土", () => {
  const r = branchRelations(["子", "丑"]);
  assert.equal(r.some((x) => x.kind === "六合" && x.element === "土"), true);
  const m = branchRelations(["午", "未"]);
  assert.equal(m.some((x) => x.kind === "六合" && x.element === "土"), true);
});

test("相冲：子午、卯酉、辰戌、巳亥", () => {
  for (const [a, b] of [["子", "午"], ["卯", "酉"], ["辰", "戌"], ["巳", "亥"]]) {
    const r = branchRelations([a, b]);
    assert.equal(r.some((x) => x.kind === "相冲"), true, `${a}${b} 应相冲`);
  }
  // 相邻两支不相冲
  assert.equal(branchRelations(["子", "丑"]).some((x) => x.kind === "相冲"), false);
});

test("三合局：申子辰俱全为水局，缺一为半合", () => {
  const full = tripleHarmonies(["申", "子", "辰"]);
  assert.equal(full.length, 1);
  assert.equal(full[0].element, "水");
  assert.equal(full[0].complete, true);

  const half = tripleHarmonies(["申", "子"]);
  assert.equal(half.length, 1);
  assert.equal(half[0].complete, false);
});

test("半合必须带长生那一支：子辰不算，申子才算", () => {
  assert.equal(tripleHarmonies(["子", "辰"]).length, 0, "子辰缺长生支，不该算半合");
  assert.equal(tripleHarmonies(["申", "子"]).length, 1);
});

test("天干五合：甲己合土、丙辛合水", () => {
  assert.equal(stemHarmonies(["甲", "己"])[0]?.element, "土");
  assert.equal(stemHarmonies(["丙", "辛"])[0]?.element, "水");
  assert.equal(stemHarmonies(["甲", "乙"]).length, 0);
});

test("五行关系：同/生/泄/克/被克五种都取得到", () => {
  assert.equal(elementRelation("木", "木"), "同");
  assert.equal(elementRelation("木", "水"), "生"); // 水生木
  assert.equal(elementRelation("木", "火"), "泄"); // 木生火
  assert.equal(elementRelation("木", "土"), "克"); // 木克土
  assert.equal(elementRelation("木", "金"), "被克"); // 金克木
});
