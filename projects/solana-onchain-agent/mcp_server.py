"""
Solana Onchain Agent MCP Server

A Model Context Protocol server that lets an AI assistant act as a real
onchain agent on Solana devnet: hold a wallet, check balances, and send
SOL transfers, instead of only reading data. Built for MLH's Solana
Hackathon (Nov 2026) AI track ("AI agents that act onchain").
"""

import os

from fastmcp import FastMCP
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed
from solana.rpc.models import TxOpts
from solders.message import Message
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.system_program import TransferParams, transfer
from solders.transaction import VersionedTransaction

from wallet import load_or_create_keypair

RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")
WALLET_PATH = os.getenv("WALLET_KEYPAIR_PATH", "./devnet-wallet.json")
LAMPORTS_PER_SOL = 1_000_000_000

mcp = FastMCP("Solana Onchain Agent")


def _client() -> AsyncClient:
    return AsyncClient(RPC_URL)


@mcp.tool
async def get_agent_wallet() -> dict:
    """
    Returns the agent's own devnet wallet address, creating one on first
    call. This is the wallet every other tool acts from.
    """

    keypair = load_or_create_keypair(WALLET_PATH)
    return {"pubkey": str(keypair.pubkey()), "network": "devnet"}


@mcp.tool
async def get_balance(pubkey: str) -> dict:
    """
    Fetches the SOL balance for any devnet address, not only the agent's own.
    """

    client = _client()
    try:
        resp = await client.get_balance(Pubkey.from_string(pubkey))
        lamports = resp.value
        return {"pubkey": pubkey, "lamports": lamports, "sol": lamports / LAMPORTS_PER_SOL}
    finally:
        await client.close()


@mcp.tool
async def request_devnet_airdrop(sol_amount: float = 1.0) -> dict:
    """
    Requests devnet SOL for the agent's own wallet via the cluster's RPC
    faucet. The public devnet RPC faucet is aggressively rate-limited and
    sometimes disabled outright; if this fails, fund the address returned
    by get_agent_wallet manually at https://faucet.solana.com and retry
    the action that needed the balance.
    """

    keypair = load_or_create_keypair(WALLET_PATH)
    client = _client()
    try:
        lamports = int(sol_amount * LAMPORTS_PER_SOL)
        resp = await client.request_airdrop(keypair.pubkey(), lamports)
        signature = resp.value
        await client.confirm_transaction(signature, commitment=Confirmed)
        return {"pubkey": str(keypair.pubkey()), "signature": str(signature), "requested_sol": sol_amount}
    finally:
        await client.close()


@mcp.tool
async def send_devnet_transfer(to_pubkey: str, sol_amount: float) -> dict:
    """
    Sends SOL from the agent's own devnet wallet to another address. This
    is the "acts onchain" step: a real signed, submitted, confirmed
    transaction, not a read.
    """

    keypair = load_or_create_keypair(WALLET_PATH)
    client = _client()
    try:
        recent_blockhash = (await client.get_latest_blockhash()).value.blockhash
        lamports = int(sol_amount * LAMPORTS_PER_SOL)
        instruction = transfer(
            TransferParams(
                from_pubkey=keypair.pubkey(),
                to_pubkey=Pubkey.from_string(to_pubkey),
                lamports=lamports,
            )
        )
        message = Message.new_with_blockhash([instruction], keypair.pubkey(), recent_blockhash)
        txn = VersionedTransaction(message, [keypair])
        resp = await client.send_transaction(txn, opts=TxOpts(skip_preflight=False))
        signature = resp.value
        await client.confirm_transaction(signature, commitment=Confirmed)
        return {
            "from": str(keypair.pubkey()),
            "to": to_pubkey,
            "sol_amount": sol_amount,
            "signature": str(signature),
        }
    finally:
        await client.close()


@mcp.tool
async def get_transaction_status(signature: str) -> dict:
    """
    Fetches the confirmation status of a transaction by its signature.
    """

    client = _client()
    try:
        resp = await client.get_signature_statuses([Signature.from_string(signature)])
        status = resp.value[0]
        if status is None:
            return {"signature": signature, "status": "not_found"}
        return {
            "signature": signature,
            "confirmations": status.confirmations,
            "confirmation_status": str(status.confirmation_status),
            "err": str(status.err) if status.err else None,
        }
    finally:
        await client.close()


if __name__ == "__main__":
    mcp.run()
