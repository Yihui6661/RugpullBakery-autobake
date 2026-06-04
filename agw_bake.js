const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC_URL = process.env.RPC_URL || "https://api.mainnet.abs.xyz";
const CHAIN_ID = 2741n;
const CHAIN_ID_NUMBER = Number(CHAIN_ID);
const BAKE_CONTRACT = "0x30b49389d5271712b7e539a690b2f7b92afa3c31";
const BAKE_ABI = [
  {
    type: "function",
    name: "bake",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
];
const EVENT_ABI = [
  "event CookieBaked(address indexed player, uint256 indexed seasonId, uint256 indexed clanId, uint256 amount, uint16 multiplierBps)",
  "event CookiesMinted(address indexed player, uint256 indexed seasonId, uint256 indexed clanId, uint256 amount, uint256 newBalance, uint16 multiplierBps)",
];
const EVENT_IFACE = new ethers.Interface(EVENT_ABI);

function isBareCommand(command) {
  return !command.includes("\\") && !command.includes("/") && !command.includes(":");
}

function commandExists(command) {
  if (!isBareCommand(command)) return true;
  const checker = process.platform === "win32" ? "where.exe" : "command";
  const checkerArgs = process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(checker, checkerArgs, {
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0;
}

function parseArgs(argv) {
  const args = {
    execute: false,
    rpc: process.env.RPC_URL || RPC_URL,
    cli: process.env.AGW_CLI || "",
    useNpx: process.env.AGW_USE_NPX === "1",
    registry: process.env.BAKERY_REGISTRY || "",
    historyBlocks: Number(process.env.HISTORY_BLOCKS || "5000000"),
    logChunkSize: Number(process.env.LOG_CHUNK_SIZE || "50000"),
    minMultiplierBps: "",
    requireMultiplierBps: "",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--execute") {
      args.execute = true;
    } else if (arg === "--dry-run") {
      args.execute = false;
    } else if (arg === "--rpc") {
      args.rpc = argv[++i];
    } else if (arg === "--cli") {
      args.cli = argv[++i];
    } else if (arg === "--use-npx") {
      args.useNpx = true;
    } else if (arg === "--registry") {
      args.registry = argv[++i];
    } else if (arg === "--history-blocks") {
      args.historyBlocks = Number(argv[++i]);
    } else if (arg === "--log-chunk-size") {
      args.logChunkSize = Number(argv[++i]);
    } else if (arg === "--min-multiplier-bps") {
      args.minMultiplierBps = argv[++i];
    } else if (arg === "--min-multiplier") {
      args.minMultiplierBps = String(Math.floor(Number(argv[++i]) * 10000));
    } else if (arg === "--require-multiplier-bps") {
      args.requireMultiplierBps = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.registry && !ethers.isAddress(args.registry)) {
    throw new Error("BAKERY_REGISTRY / --registry must be an address");
  }
  if (!Number.isInteger(args.historyBlocks) || args.historyBlocks <= 0) {
    throw new Error("HISTORY_BLOCKS / --history-blocks must be a positive integer");
  }
  if (!Number.isInteger(args.logChunkSize) || args.logChunkSize <= 0) {
    throw new Error("LOG_CHUNK_SIZE / --log-chunk-size must be a positive integer");
  }
  if (args.minMultiplierBps && !/^\d+$/.test(args.minMultiplierBps)) {
    throw new Error("--min-multiplier-bps must be a positive integer");
  }
  if (args.requireMultiplierBps && !/^\d+$/.test(args.requireMultiplierBps)) {
    throw new Error("--require-multiplier-bps must be a positive integer");
  }
  return args;
}

function printHelp() {
  console.log(`
Usage:
  node agw_bake.js --dry-run
  node agw_bake.js --execute

Setup first:
  npm install ethers
  npm install -g @abstract-foundation/agw-cli
  agw-cli auth init --json "{\\"chainId\\":2741}" --execute

Options:
  --dry-run      Preview bake(), do not broadcast.
  --execute      Broadcast bake() through the linked AGW session.
  --rpc <url>    Abstract RPC URL. Default: ${RPC_URL}
  --cli <cmd>    AGW CLI command path/name. Default: auto-detect agw-cli/agw
  --use-npx      Run through npx -y @abstract-foundation/agw-cli
  --registry <address>            Optional current Player Registry address for faster balance log lookup.
  --history-blocks <n>            Blocks to scan backwards for latest bake/mint events. Default: 5000000.
  --log-chunk-size <n>            Log scan chunk size. Default: 50000.
  --min-multiplier <x>            Only bake when latest multiplier is at least x, e.g. 2 means 20000 bps.
  --min-multiplier-bps <bps>      Only bake when latest multiplierBps is at least this value.
  --require-multiplier-bps <bps>  Only bake when latest multiplierBps exactly equals this value.
`);
}

async function createProvider(rpcUrl) {
  const provider = new ethers.JsonRpcProvider(rpcUrl, CHAIN_ID_NUMBER, {
    staticNetwork: ethers.Network.from(CHAIN_ID_NUMBER),
  });

  let chainId;
  try {
    chainId = await provider.send("eth_chainId", []);
  } catch (error) {
    throw new Error(
      `RPC request failed for ${rpcUrl}. Try again later or pass another endpoint with --rpc. ${error.shortMessage || error.message}`,
    );
  }

  if (BigInt(chainId) !== CHAIN_ID) {
    throw new Error(`Wrong RPC chain id: expected ${CHAIN_ID}, got ${BigInt(chainId)} from ${rpcUrl}`);
  }

  return provider;
}

function resolveCliCommand(args) {
  if (args.useNpx) return "npx";
  if (args.cli) return args.cli;
  if (commandExists("agw-cli")) return "agw-cli";
  if (commandExists("agw")) return "agw";
  return "agw-cli";
}

function createJsonPayloadFile(payload) {
  const dir = path.join(process.cwd(), ".agw-payloads");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `payload-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(payload), "utf8");
  return file;
}

function buildCommand(args, subcommand, jsonPayloadFile, modeFlag) {
  const relativePayloadFile = path.relative(process.cwd(), jsonPayloadFile);
  const parts = [...subcommand, "--json", `@${relativePayloadFile}`];
  if (modeFlag) parts.push(modeFlag);

  if (args.useNpx) {
    return {
      command: "npx",
      args: ["-y", "@abstract-foundation/agw-cli", ...parts],
    };
  }
  return { command: resolveCliCommand(args), args: parts };
}

function runAgw(args, subcommand, payload, modeFlag) {
  const jsonPayloadFile = createJsonPayloadFile(payload);
  const command = buildCommand(args, subcommand, jsonPayloadFile, modeFlag);

  try {
    if (!commandExists(command.command)) {
      const installHint =
        command.command === "agw" || command.command === "agw-cli"
          ? "Install it with `npm install -g @abstract-foundation/agw-cli`, or pass `--cli C:\\path\\to\\agw-cli.cmd`."
          : "Make sure it is installed and available in PATH.";
      throw new Error(`Cannot find ${command.command}. ${installHint}`);
    }

    const result = spawnSync(command.command, command.args, {
      encoding: "utf8",
      shell: process.platform === "win32",
    });

    if (result.error) {
      throw new Error(
        `Failed to run ${command.command}. Install AGW CLI first or pass --cli. ${result.error.message}`,
      );
    }

    if (result.status !== 0) {
      const stderr = result.stderr.trim();
      const stdout = result.stdout.trim();
      throw new Error(stderr || stdout || `${command.command} exited with ${result.status}`);
    }

    return parseJsonOutput(result.stdout);
  } finally {
    try {
      fs.unlinkSync(jsonPayloadFile);
    } catch {
      // Best effort cleanup only.
    }
  }
}

function parseJsonOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}\s*$/);
    if (match) return JSON.parse(match[0]);
    return { raw: trimmed };
  }
}

function extractAddress(result) {
  const candidates = [
    result.accountAddress,
    result.address,
    result.walletAddress,
    result.account,
    result.data && result.data.accountAddress,
    result.data && result.data.address,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (ethers.isAddress(candidate)) return ethers.getAddress(candidate);
  }

  const text = JSON.stringify(result);
  const match = text.match(/0x[a-fA-F0-9]{40}/);
  if (match) return ethers.getAddress(match[0]);
  throw new Error(`Could not find AGW address in CLI output: ${text}`);
}

function topicAddress(address) {
  return ethers.zeroPadValue(ethers.getAddress(address), 32);
}

function formatMultiplier(multiplierBps) {
  if (multiplierBps === null || multiplierBps === undefined) return "unknown";
  const bps = BigInt(multiplierBps);
  const whole = bps / 10000n;
  const frac = (bps % 10000n).toString().padStart(4, "0").replace(/0+$/, "");
  return `${bps.toString()} bps (${whole.toString()}${frac ? `.${frac}` : ""}x)`;
}

async function findLatestLog(provider, filter, historyBlocks, chunkSize) {
  const latestBlock = await provider.getBlockNumber();
  const minBlock = Math.max(0, latestBlock - historyBlocks);

  for (let toBlock = latestBlock; toBlock >= minBlock; toBlock -= chunkSize) {
    const fromBlock = Math.max(minBlock, toBlock - chunkSize + 1);
    const logs = await provider.getLogs({
      ...filter,
      fromBlock,
      toBlock,
    });
    if (logs.length > 0) {
      return logs.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return b.blockNumber - a.blockNumber;
        return b.index - a.index;
      })[0];
    }
  }

  return null;
}

async function getBakeryState(provider, player, args) {
  const bakedTopic = EVENT_IFACE.getEvent("CookieBaked").topicHash;
  const mintedTopic = EVENT_IFACE.getEvent("CookiesMinted").topicHash;
  const playerTopic = topicAddress(player);

  const [bakedLog, mintedLog] = await Promise.all([
    findLatestLog(
      provider,
      {
        address: BAKE_CONTRACT,
        topics: [bakedTopic, playerTopic],
      },
      args.historyBlocks,
      args.logChunkSize,
    ),
    findLatestLog(
      provider,
      {
        address: args.registry ? ethers.getAddress(args.registry) : undefined,
        topics: [mintedTopic, playerTopic],
      },
      args.historyBlocks,
      args.logChunkSize,
    ),
  ]);

  const state = {
    latestBake: null,
    latestMint: null,
  };

  if (bakedLog) {
    const parsed = EVENT_IFACE.parseLog(bakedLog);
    state.latestBake = {
      txHash: bakedLog.transactionHash,
      blockNumber: bakedLog.blockNumber,
      registry: bakedLog.address,
      player: parsed.args.player,
      seasonId: parsed.args.seasonId,
      clanId: parsed.args.clanId,
      amount: parsed.args.amount,
      multiplierBps: parsed.args.multiplierBps,
    };
  }

  if (mintedLog) {
    const parsed = EVENT_IFACE.parseLog(mintedLog);
    state.latestMint = {
      txHash: mintedLog.transactionHash,
      blockNumber: mintedLog.blockNumber,
      registry: mintedLog.address,
      player: parsed.args.player,
      seasonId: parsed.args.seasonId,
      clanId: parsed.args.clanId,
      amount: parsed.args.amount,
      newBalance: parsed.args.newBalance,
      multiplierBps: parsed.args.multiplierBps,
    };
  }

  return state;
}

function printBakeryState(state) {
  if (!state.latestBake && !state.latestMint) {
    console.log("Latest bakery state: no CookieBaked/CookiesMinted events found in scan range.");
    return;
  }

  if (state.latestBake) {
    console.log(`Latest CookieBaked block: ${state.latestBake.blockNumber}`);
    console.log(`Latest seasonId: ${state.latestBake.seasonId}`);
    console.log(`Latest clanId: ${state.latestBake.clanId}`);
    console.log(`Latest baked amount: ${state.latestBake.amount}`);
    console.log(`Latest multiplier: ${formatMultiplier(state.latestBake.multiplierBps)}`);
  }

  if (state.latestMint) {
    console.log(`Latest mint registry: ${state.latestMint.registry}`);
    console.log(`Latest newBalance: ${state.latestMint.newBalance}`);
    if (!state.latestBake) {
      console.log(`Latest seasonId: ${state.latestMint.seasonId}`);
      console.log(`Latest clanId: ${state.latestMint.clanId}`);
      console.log(`Latest multiplier: ${formatMultiplier(state.latestMint.multiplierBps)}`);
    }
  }
}

function assertMultiplierAllowed(state, args) {
  if (!args.minMultiplierBps && !args.requireMultiplierBps) return;

  const latest = state.latestBake || state.latestMint;
  if (!latest || latest.multiplierBps === undefined) {
    throw new Error("Cannot check multiplier threshold because no latest multiplier event was found.");
  }

  const multiplier = BigInt(latest.multiplierBps);
  if (args.minMultiplierBps && multiplier < BigInt(args.minMultiplierBps)) {
    throw new Error(
      `Multiplier too low: current/latest ${formatMultiplier(multiplier)}, required at least ${formatMultiplier(args.minMultiplierBps)}.`,
    );
  }

  if (args.requireMultiplierBps && multiplier !== BigInt(args.requireMultiplierBps)) {
    throw new Error(
      `Multiplier mismatch: current/latest ${formatMultiplier(multiplier)}, required exactly ${formatMultiplier(args.requireMultiplierBps)}.`,
    );
  }
}

function extractTxHash(result) {
  const candidates = [
    result.txHash,
    result.transactionHash,
    result.hash,
    result.data && result.data.txHash,
    result.data && result.data.transactionHash,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (/^0x[a-fA-F0-9]{64}$/.test(candidate)) return candidate;
  }

  const match = JSON.stringify(result).match(/0x[a-fA-F0-9]{64}/);
  return match ? match[0] : null;
}

async function printBakeEvents(provider, txHash) {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) return;

  for (const log of receipt.logs) {
    try {
      const parsed = EVENT_IFACE.parseLog(log);
      if (parsed.name === "CookieBaked") {
        console.log(
          `CookieBaked: player=${parsed.args.player}, seasonId=${parsed.args.seasonId}, clanId=${parsed.args.clanId}, amount=${parsed.args.amount}, multiplierBps=${parsed.args.multiplierBps}`,
        );
      } else if (parsed.name === "CookiesMinted") {
        console.log(
          `CookiesMinted: player=${parsed.args.player}, seasonId=${parsed.args.seasonId}, clanId=${parsed.args.clanId}, amount=${parsed.args.amount}, newBalance=${parsed.args.newBalance}, multiplierBps=${parsed.args.multiplierBps}`,
        );
      }
    } catch {
      // Ignore unrelated logs.
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const provider = await createProvider(args.rpc);
  const modeFlag = args.execute ? "--execute" : "--dry-run";

  console.log(`RPC: ${args.rpc}`);
  console.log("Checking linked AGW wallet...");
  const walletInfo = runAgw(args, ["wallet", "address"], {});
  const agwAddress = extractAddress(walletInfo);
  const balance = await provider.getBalance(agwAddress);

  console.log(`AGW: ${agwAddress}`);
  console.log(`Contract: ${BAKE_CONTRACT}`);
  console.log("Function: bake()");
  console.log(`AGW ETH balance: ${ethers.formatEther(balance)} ETH`);

  console.log("Loading latest bakery state from events...");
  const bakeryState = await getBakeryState(provider, agwAddress, args);
  printBakeryState(bakeryState);
  assertMultiplierAllowed(bakeryState, args);

  const payload = {
    address: BAKE_CONTRACT,
    abi: BAKE_ABI,
    functionName: "bake",
    args: [],
    value: "0",
  };

  console.log(args.execute ? "Executing bake() through AGW CLI..." : "Previewing bake() through AGW CLI...");
  const result = runAgw(args, ["contract", "write"], payload, modeFlag);
  console.log(JSON.stringify(result, null, 2));

  if (!args.execute) {
    console.log("Preview only. Re-run with --execute to broadcast.");
    return;
  }

  const txHash = extractTxHash(result);
  if (txHash) {
    console.log(`Transaction: https://abscan.org/tx/${txHash}`);
    await printBakeEvents(provider, txHash);
  }
}

main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
