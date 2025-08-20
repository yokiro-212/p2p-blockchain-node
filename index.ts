/* 

   a P2P(Peer-To-Peer) blockchain node in typescript
   Author: @Yokiro (_yokiro)

   Usage:
   Open 2 terminals and run:
    1st terminal: npm i cross-env
                  npx cross-env PORT=3001 P2P_PORT=6001 npx tsx index.ts
    2nd terminal: npm install --save-dev @types/express @types/body-parser @types/ws
                  npx cross-env PORT=3002 P2P_PORT=6002 PEERS=ws://localhost:6001 npx tsx index.ts

    tsx btw here refers to https://www.npmjs.com/package/tsx

    Again, this can be used to create a custom cryptocurrency if a wallet(with cryptographic signatures), custom coin is added.
    
*/
import http from "http";
import https from "https";
import crypto from "crypto";
import express, { Request, Response } from "express";
import bodyParser from "body-parser";
import { WebSocketServer, WebSocket } from "ws";

const PORT: number = Number(process.env.PORT) || 3001;
const P2P_PORT: number = Number(process.env.P2P_PORT) || 6001;
const PEERS: string[] = (process.env.PEERS || "").split(",").filter(Boolean);

const SHA256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const now = (): number => Date.now();

async function customRequest(
  url: string,
  {
    method = "GET",
    headers = {},
    body,
  }: { method?: string; headers?: any; body?: any } = {}
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === "https:" ? https : http;

      const options: http.RequestOptions = {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + (u.search || ""),
        method,
        headers: { "Content-Type": "application/json", ...headers },
      };

      const req = lib.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode || 0,
              data: data ? JSON.parse(data) : null,
            });
          } catch {
            resolve({ status: res.statusCode || 0, data });
          }
        });
      });

      req.on("error", reject);

      if (body) {
        req.write(typeof body === "string" ? body : JSON.stringify(body));
      }

      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// --- Block-Chain ---
interface Transaction {
  from: string;
  to: string;
  amount: number;
}

interface BlockData {
  tx: Transaction[];
  [key: string]: any;
}

class Block {
  constructor(
    public index: number,
    public prevHash: string,
    public timestamp: number,
    public data: BlockData,
    public nonce: number,
    public difficulty: number,
    public hash: string
  ) {}

  static calculateHash(
    index: number,
    prevHash: string,
    timestamp: number,
    data: BlockData,
    nonce: number,
    difficulty: number
  ): string {
    return SHA256(
      index + prevHash + timestamp + JSON.stringify(data) + nonce + difficulty
    );
  }

  static mine(
    index: number,
    prevHash: string,
    timestamp: number,
    data: BlockData,
    difficulty: number
  ) {
    let nonce = 0;
    while (true) {
      const hash = Block.calculateHash(
        index,
        prevHash,
        timestamp,
        data,
        nonce,
        difficulty
      );
      if (hash.startsWith("0".repeat(difficulty))) {
        return new Block(index, prevHash, timestamp, data, nonce, difficulty, hash);
      }
      nonce++;
    }
  }

  static genesis(): Block {
    const data: BlockData = {
      tx: [{ from: "genesis", to: "network", amount: 0 }],
    };
    return Block.mine(0, "0".repeat(64), 1735689600000, data, 2);
  }
}

class Blockchain {
  public chain: Block[] = [Block.genesis()];
  private txPool: Set<string> = new Set();
  private readonly targetTime = 60;
  private readonly maxDifficulty = 6;
  private readonly minDifficulty = 2;

  getLatest(): Block {
    return this.chain[this.chain.length - 1];
  }

  difficulty(): number {
    const last = this.getLatest();
    if (this.chain.length < 3) return last.difficulty;
    const prev = this.chain[this.chain.length - 2];
    const dt = last.timestamp - prev.timestamp;
    let d = last.difficulty + (dt < this.targetTime ? 1 : -1);

    return Math.max(this.minDifficulty, Math.min(this.maxDifficulty, d));
  }

  addTx(tx: Transaction): boolean {
    if (
      !tx ||
      typeof tx.from !== "string" ||
      typeof tx.to !== "string" ||
      typeof tx.amount !== "number" ||
      tx.amount <= 0
    )
      return false;
    const key = JSON.stringify(tx);
    if (!this.txPool.has(key)) this.txPool.add(key);

    return true;
  }

  pendingTx(): Transaction[] {
    return Array.from(this.txPool).map((s) => JSON.parse(s));
  }

  addBlock(block: Block): boolean {
    const prev = this.getLatest();
    if (prev.hash !== block.prevHash) return false;
    if (block.index !== prev.index + 1) return false;
    const check = Block.calculateHash(
      block.index,
      block.prevHash,
      block.timestamp,
      block.data,
      block.nonce,
      block.difficulty
    );
    if (check !== block.hash) return false;
    if (!block.hash.startsWith("0".repeat(block.difficulty))) return false;
    this.chain.push(block);
    return true;
  }

  mineBlock(extraData: any = {}): Block | null {
    const data = { tx: this.pendingTx(), ...extraData };
    const prev = this.getLatest();
    const ts = now();
    const diff = this.difficulty();
    const block = Block.mine(prev.index + 1, prev.hash, ts, data, diff);
    if (this.addBlock(block)) {
      this.txPool.clear();
      return block;
    }
    return null;
  }

  isValidChain(chain: Block[]): boolean {
    if (!Array.isArray(chain) || chain.length === 0) return false;
    const g2 = Block.genesis();
    if (JSON.stringify(chain[0]) !== JSON.stringify(g2)) return false;
    for (let i = 1; i < chain.length; i++) {
      const b = chain[i],
        p = chain[i - 1];
      const calc = Block.calculateHash(
        b.index,
        b.prevHash,
        b.timestamp,
        b.data,
        b.nonce,
        b.difficulty
      );
      if (
        p.hash !== b.prevHash ||
        calc !== b.hash ||
        !b.hash.startsWith("0".repeat(b.difficulty))
      )
        return false;
    }
    return true;
  }

  replaceChain(newChain: Block[]): boolean {
    if (this.isValidChain(newChain) && this.work(newChain) > this.work(this.chain)) {
      this.chain = newChain.map(
        (b) =>
          new Block(
            b.index,
            b.prevHash,
            b.timestamp,
            b.data,
            b.nonce,
            b.difficulty,
            b.hash
          )
      );
      this.txPool.clear();
      return true;
    }
    return false;
  }

  work(chain: Block[]): number {
    return chain.reduce((acc, b) => acc + Math.pow(2, b.difficulty), 0);
  }
}

const chain = new Blockchain();

// --- P2P ---
enum MsgType {
  QUERY_LATEST = "QUERY_LATEST",
  QUERY_ALL = "QUERY_ALL",
  RESPONSE_BLOCKCHAIN = "RESPONSE_BLOCKCHAIN",
  NEW_BLOCK = "NEW_BLOCK",
  NEW_TX = "NEW_TX",
}

const sockets: Set<WebSocket> = new Set();

function wsSend(ws: WebSocket, msg: any) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: any) {
  sockets.forEach((s) => wsSend(s, msg));
}

function handleMessage(ws: WebSocket, msg: any) {
  switch (msg.type) {
    case MsgType.QUERY_LATEST:
      wsSend(ws, {
        type: MsgType.RESPONSE_BLOCKCHAIN,
        data: [chain.getLatest()],
      });
      break;
    case MsgType.QUERY_ALL:
      wsSend(ws, { type: MsgType.RESPONSE_BLOCKCHAIN, data: chain.chain });
      break;
    case MsgType.RESPONSE_BLOCKCHAIN:
      if (!Array.isArray(msg.data)) return;
      const received = msg.data
        .map(
          (b: Block) =>
            new Block(b.index, b.prevHash, b.timestamp, b.data, b.nonce, b.difficulty, b.hash)
        )
        .sort((a: Block, b: Block) => a.index - b.index);
      const latestRecv = received[received.length - 1];
      const latestLocal = chain.getLatest();
      if (latestRecv.index > latestLocal.index) {
        if (latestLocal.hash === latestRecv.prevHash) {
          if (chain.addBlock(latestRecv))
            broadcast({ type: MsgType.NEW_BLOCK, data: latestRecv });
        } else if (received.length === 1) {
          broadcast({ type: MsgType.QUERY_ALL });
        } else {
          chain.replaceChain(received);
          broadcast({ type: MsgType.RESPONSE_BLOCKCHAIN, data: chain.chain });
        }
      }
      break;
    case MsgType.NEW_BLOCK:
      chain.addBlock(msg.data);
      break;
    case MsgType.NEW_TX:
      if (chain.addTx(msg.data))
        broadcast({ type: MsgType.NEW_TX, data: msg.data });
      break;
  }
}

function initConnection(ws: WebSocket) {
  sockets.add(ws);
  ws.on("message", (d: Buffer) => {
    try {
      handleMessage(ws, JSON.parse(d.toString()));
    } catch {}
  });
  ws.on("close", () => sockets.delete(ws));
  ws.on("error", () => sockets.delete(ws));
  wsSend(ws, { type: MsgType.QUERY_LATEST });
}

const p2pServer = new WebSocketServer({ port: P2P_PORT });
p2pServer.on("connection", initConnection);

async function connectToPeer(addr: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(addr);
      ws.on("open", () => {
        initConnection(ws);
        resolve(true);
      });

      ws.on("error", () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

// --- HTTP API ---
const app = express();
app.use(bodyParser.json());

app.get("/chain", (_req: Request, res: Response) => res.json(chain.chain));

app.get("/latest", (_req: Request, res: Response) =>
  res.json(chain.getLatest())
);

app.get("/peers", (_req: Request, res: Response) =>
  res.json(
    Array.from(sockets).map(
      (s) => (s as any)._socket?.remoteAddress || "ws"
    )
  )
);

app.get("/txpool", (_req: Request, res: Response) =>
  res.json(chain.pendingTx())
);

app.post("/tx", (req: Request, res: Response) => {
  if (chain.addTx(req.body)) {
    broadcast({ type: MsgType.NEW_TX, data: req.body });
    res.json({ success: true });
  } else res.status(400).json({ ok: false });
});

app.post("/mine", (req: Request, res: Response) => {
  const b = chain.mineBlock({ note: req.body?.note || "mined" });
  if (b) {
    broadcast({ type: MsgType.NEW_BLOCK, data: b });
    res.json(b);
  } else res.status(400).json({ ok: false });
});

app.post("/peers/add", async (req: Request, res: Response) => {
  const { address } = req.body || {};
  if (!address) return res.status(400).json({ ok: false });
  const ok = await connectToPeer(address);
  res.json({ ok });
});

app.listen(PORT, () => {
  PEERS.forEach((p) => connectToPeer(p));
  console.log(`HTTP:${PORT} P2P:${P2P_PORT}`);
});
