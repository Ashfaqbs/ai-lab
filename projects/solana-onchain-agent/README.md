# Solana Onchain Agent (MCP Server)

A Model Context Protocol server that gives an AI assistant a real Solana
devnet wallet and lets it act onchain — not just read chain data, but hold
a keypair, check balances, and send signed, confirmed transfers.

Built for [MLH's Solana Hackathon](https://www.mlh.com/events/solana-hackathon)
(Nov 6-8, 2026), AI track: "AI agents that act onchain."

## Why this exists

Most "AI + blockchain" demos are read-only: ask an LLM to summarize a
wallet's history or explain a transaction. This server closes the loop —
the agent owns a keypair and can actually move SOL, so a conversation like
"send 0.1 SOL to this address once my balance clears 1 SOL" is something
the agent can execute, not just describe.

It follows the same MCP server shape as my other projects
([apache-flink-mcp-server](https://github.com/Ashfaqbs/apache-flink-mcp-server)):
small, typed tool functions over `fastmcp`, no framework ceremony.

## Tools

| Tool | What it does |
|---|---|
| `get_agent_wallet` | Returns the agent's devnet address, creating a keypair on first call |
| `get_balance` | SOL balance for any devnet address |
| `request_devnet_airdrop` | Requests devnet SOL into the agent's own wallet via RPC |
| `send_devnet_transfer` | Signs and submits a real SOL transfer from the agent's wallet |
| `get_transaction_status` | Confirmation status for a transaction signature |

## Known limitation: the public devnet airdrop RPC is unreliable

Solana's public `api.devnet.solana.com` `requestAirdrop` RPC method is
aggressively rate-limited and frequently returns `410 Gone` under abuse
protection — confirmed while building this. `request_devnet_airdrop` will
raise in that case. If it does, fund the address from `get_agent_wallet`
manually once at [faucet.solana.com](https://faucet.solana.com) (web UI,
~30 seconds, no API) and then `send_devnet_transfer` and
`get_transaction_status` work against a real funded account exactly as
written — both were built and exercised against live devnet RPC calls,
only the faucet step itself needs a human in the loop.

## Setup

```bash
pip install -r requirements.txt
python mcp_server.py
```

Environment variables (all optional):
- `SOLANA_RPC_URL` — defaults to `https://api.devnet.solana.com`
- `WALLET_KEYPAIR_PATH` — defaults to `./devnet-wallet.json` (gitignored; generated on first run)

## Client configuration (Claude Desktop / MCP-compatible clients)

```json
{
  "mcpServers": {
    "solana-onchain-agent": {
      "command": "python",
      "args": ["/absolute/path/to/mcp_server.py"]
    }
  }
}
```

## License

MIT
