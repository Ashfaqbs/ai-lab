# proxy.py Used to create a FastMCP proxy server where the backend is an HTTP server and a proxy server is mapped to MCP client like claude, check claude config for better understanding. /config/claude/config file 
from fastmcp import FastMCP

mcp = FastMCP.as_proxy("http://127.0.0.1:8000/mcp", name="Simple Math Proxy")

if __name__ == "__main__":
    mcp.run()
