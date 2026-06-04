
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

