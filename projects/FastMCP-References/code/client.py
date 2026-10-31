import asyncio
from fastmcp import Client, FastMCP

# In-memory server (ideal for testing)
server = FastMCP("Simple Math Tools")
client = Client(server)

# HTTP server 
client = Client("http://127.0.0.1:8000/mcp/")

# Local Python script
# client = Client("my_mcp_server.py") this runs a local script like STDIO

async def main():
    async with client:
        # Basic server interaction
        await client.ping()
        
        # List available operations
        tools = await client.list_tools()
        resources = await client.list_resources()
        prompts = await client.list_prompts()
        
        # Execute operations
        result = await client.call_tool("join_names", {"first_name": "Mohammad", "last_name": "Ashfaq"})
        print(result)

asyncio.run(main())

# OP

# (henv) PS C:\tmp\git\MCP> python .\client.py
# CallToolResult(content=[TextContent(type='text', text='ohammad shfaq', annotations=None, meta=None)], structured_content={'result': 'ohammad shfaq'}, data='ohammad shfaq', is_error=False)
# (henv) PS C:\tmp\git\MCP>
