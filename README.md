
## Rugpull Bakery bake 脚本


```

预览 bake：

```bash
node agw_bake.js --dry-run
```

执行 bake：

```bash
node agw_bake.js --execute
```

显示当前地址最近一次 bake/mint 状态，包括 `seasonId`、`clanId`、`multiplierBps`、`newBalance`：

```bash
node agw_bake.js --dry-run
```

只在最近倍数大于等于指定倍数时 bake，例如至少 2x：

```bash
node agw_bake.js --min-multiplier 2 --dry-run
node agw_bake.js --min-multiplier 2 --execute
```

也可以用 bps 精确控制，`20000 bps = 2x`：

```bash
node agw_bake.js --min-multiplier-bps 20000 --execute
node agw_bake.js --require-multiplier-bps 31500 --execute
```

如果知道当前赛季的 Player Registry 地址，可以传入以加快 `newBalance` 日志查询：

```bash
node agw_bake.js --registry 0x663d69ecff14b4dbd245cdac03f2e1deb68ed250 --dry-run
```

`agw_bake.js` 同样通过 AGW CLI session 发起交易，不保存私钥。

## 常见问题

### 1. preview 是不是投票成功？

不是。

如果返回：

```json
{
  "preview": true,
  "requiresExplicitExecute": true
}
```

说明只是预览成功，没有上链。

需要执行：

```bash
node agw_vote.js --app-id 15 --execute
```

### 2. 出现 RPC timeout 怎么办？

说明 Abstract RPC 暂时连不上或网络不稳定。

可以重试，或者换 RPC：

```bash
node agw_vote.js --list-votes --rpc "你的RPC地址"
```

### 3. 出现 Cannot find agw-cli 怎么办？

说明系统找不到 AGW CLI。

先安装：

```bash
npm install -g @abstract-foundation/agw-cli
```

或者用 `--cli` 指定完整路径。

### 4. AGW session 过期怎么办？

重新授权：

```bash
agw-cli auth init --json '{"chainId":2741}' --execute
```
