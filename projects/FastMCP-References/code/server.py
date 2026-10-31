from fastmcp import FastMCP, Context
import logging # simple logging , use ctx for better logging
from fastmcp import FastMCP
from fastmcp.server.auth import BearerAuthProvider  # not used
import asyncio


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp-server")
#  use Context Loggers : https://gofastmcp.com/servers/logging

mcp = FastMCP(name="Simple Math Tools")  



# @mcp.tool
# def add(a: int, b: int) -> int:
#     """Add two integers and return the result."""
#     result = a + b
#     logger.info(f"add({a}, {b}) -> {result}")
#     return result


# @mcp.tool - > 

@mcp.tool(
    name="add",
    description="Add two integers and return the result."
)
async def add(a: int = 0 , b: int = 0, ctx: Context = None) -> int:
    await ctx.debug(f"Received inputs: a={a}, b={b}")
    result = a + b
    await ctx.info(f"Computed result: {result}")
    return result

# @mcp.tool
# def join_names(first_name: str, last_name: str) -> str:
#     """
#     Join two names after removing the first character of each.
#     E.g. ('Alice', 'Smith') → 'lice mith'
#     """
#     if len(first_name) > 1 and len(last_name) > 1:
#         result = f"{first_name[1:]} {last_name[1:]}"
#     else:
#         result = ""
#     logger.info(f"join_names({first_name}, {last_name}) -> {result}")
#     return result


# @mcp.tool - >

@mcp.tool(
    name="join_names",
    description="Join two names after removing the first letter of each. E.g., 'Alice' and 'Smith' → 'lice mith'"
)
async def join_names(
    first_name: str = "John",
    last_name: str = "Doe",
    ctx: Context = None
) -> str:
    """
    Join two names after removing the first character of each.
    E.g. ('Alice', 'Smith') → 'lice mith'
    """
    await ctx.debug(f"Received: first_name='{first_name}', last_name='{last_name}'")

    if len(first_name) > 1 and len(last_name) > 1:
        result = f"{first_name[1:]} {last_name[1:]}"
        await ctx.info(f"Joined names: {result}")
    else:
        result = ""
        await ctx.warning("One or both names too short to trim")

    return result


# Progress  https://gofastmcp.com/servers/progress Note clients also need to implement this progress to get from server
FAKE_LOGS = [
    "INFO Connected to database",
    "WARN Connection is slow",
    "ERROR Timeout while writing to disk",
    "INFO Retrying operation",
    "ERROR Timeout while fetching user info",
    "INFO Operation completed",
    "WARN Low memory warning",
    "ERROR Unable to resolve hostname",
    "INFO Cleanup started",
    "INFO Cleanup finished"
]


@mcp.tool
async def find_lucky_number(name: str, ctx: Context) -> dict:
    """
    Calculates a 'lucky number' from the input name,
    with progress updates for each letter processed.
    """
    name = name.strip().lower()
    total = len(name)
    lucky_sum = 0

    for i, char in enumerate(name):
        await asyncio.sleep(1)  # simulate time taken to process
        weight = ord(char) if char.isalpha() else 0
        lucky_sum += weight
        await ctx.report_progress(progress=i + 1, total=total)

    lucky_number = (lucky_sum % 100) + 1  # force range 1–100
    return {
        "name": name,
        "lucky_number": lucky_number,
        "formula": f"sum(ord(c) for c in name) % 100 + 1"
    }



if __name__ == "__main__":
    logger.info("Starting MCP server on http://127.0.0.1:8000/mcp")
    mcp.run(transport="http", host="127.0.0.1", port=8000)
