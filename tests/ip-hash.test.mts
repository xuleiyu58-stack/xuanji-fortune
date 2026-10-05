import test from "node:test";
import assert from "node:assert/strict";
import { hashIp, ipHashSalt } from "../src/lib/server/usage-store.ts";

/**
 * IP 哈希必须加盐。
 *
 * 原先它是裸的 `sha256(ip)`。IPv4 空间只有 2^32 —— 把全网段跑一遍建张表
 * 就能反查，这在隐私上等于明文存 IP。而隐私政策里对用户的承诺恰恰是
 * "由哈希反推不回你的 IP"。所以这不是"更安全一点"，是"说得到做不到"。
 *
 * 顺带钉住缺盐时的行为：生产环境必须报错，而不是悄悄退回无盐哈希 ——
 * 一个静默降级的安全措施，比没有这个措施更危险（因为没人会去查）。
 */

const ENV_KEYS = ["IP_HASH_SALT", "PASS_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/** 把环境变量恢复到调用前的样子，免得污染同进程里的其他测试。 */
function withEnv<T>(patch: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => T): T {
  const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const IP = "203.0.113.7";
/** 未加盐的裸 sha256(IP) 前 32 位 —— 加盐后绝不该出现这个值。 */
const BARE = "fec52565aa0cf18f57d7cf5b3ac72850";

test("加了盐：哈希与裸 sha256(ip) 不同", () => {
  withEnv({ IP_HASH_SALT: "s3cret" }, () => {
    const h = hashIp(IP);
    assert.notEqual(h, BARE, "还是裸哈希 —— 加盐没生效");
    assert.match(h, /^[0-9a-f]{32}$/, "哈希形态变了，确认下是否误改了长度或编码");
  });
});

test("同一个 IP、不同的盐，得到的哈希不同", () => {
  const a = withEnv({ IP_HASH_SALT: "salt-a" }, () => hashIp(IP));
  const b = withEnv({ IP_HASH_SALT: "salt-b" }, () => hashIp(IP));
  assert.notEqual(a, b, "换盐不换哈希 —— 盐根本没参与运算");
});

test("同一个 IP、同一个盐，结果稳定（否则每天的次数限制会失效）", () => {
  withEnv({ IP_HASH_SALT: "s3cret" }, () => {
    assert.equal(hashIp(IP), hashIp(IP));
  });
});

test("不同 IP 仍然区分得开", () => {
  withEnv({ IP_HASH_SALT: "s3cret" }, () => {
    assert.notEqual(hashIp("203.0.113.7"), hashIp("203.0.113.8"));
  });
});

test("没有 IP_HASH_SALT 时复用 PASS_SECRET，不必多记一个环境变量", () => {
  const viaPass = withEnv({ PASS_SECRET: "from-pass" }, () => hashIp(IP));
  const viaOwn = withEnv({ IP_HASH_SALT: "from-pass" }, () => hashIp(IP));
  assert.equal(viaPass, viaOwn, "复用 PASS_SECRET 的路径与独立变量应当等价");
});

test("IP_HASH_SALT 优先于 PASS_SECRET", () => {
  withEnv({ IP_HASH_SALT: "own", PASS_SECRET: "from-pass" }, () => {
    assert.equal(ipHashSalt(), "own");
  });
});

test("生产环境缺盐必须报错，不得静默退回无盐哈希", () => {
  withEnv({}, () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      assert.throws(() => hashIp(IP), /IP 哈希密钥未配置/, "生产环境缺盐居然算出了哈希");
    } finally {
      if (saved === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved;
    }
  });
});

test("配了 Supabase 就等于生产环境：缺盐同样报错", () => {
  withEnv(
    {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    () => {
      const saved = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      try {
        assert.throws(() => hashIp(IP), /IP 哈希密钥未配置/);
      } finally {
        if (saved === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = saved;
      }
    }
  );
});

test("开发环境缺盐不阻断（不落库，且不该让本地跑不起来）", () => {
  withEnv({}, () => {
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      assert.match(hashIp(IP), /^[0-9a-f]{32}$/);
    } finally {
      if (saved === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved;
    }
  });
});
