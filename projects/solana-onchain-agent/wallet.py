"""
Devnet wallet persistence for the Solana onchain agent.
"""

import json
import os

from solders.keypair import Keypair


def load_or_create_keypair(path: str) -> Keypair:
    """
    Loads a keypair from a solana-keygen style JSON byte array at path,
    generating and persisting a new one if the file does not exist yet.
    """

    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as handle:
            secret_bytes = bytes(json.load(handle))
        return Keypair.from_bytes(secret_bytes)

    keypair = Keypair()
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(list(bytes(keypair)), handle)

    return keypair
