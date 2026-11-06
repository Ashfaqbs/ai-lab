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
        if os.name == "posix" and os.stat(path).st_mode & 0o077:
            raise PermissionError(f"{path} is readable by group/others; refusing to load a private key from it")
        with open(path, "r", encoding="utf-8") as handle:
            secret_bytes = bytes(json.load(handle))
        return Keypair.from_bytes(secret_bytes)

    keypair = Keypair()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(list(bytes(keypair)), handle)

    return keypair
