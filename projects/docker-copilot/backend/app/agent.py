from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.tools import tool
from langchain_groq import ChatGroq

from app import docker_tools
from app.config import get_settings

SYSTEM_PROMPT = """You are Docker Copilot, an assistant that observes and manages \
Docker containers on the user's machine.

You may freely call list_containers, inspect_container, get_logs, and get_stats \
at any time to answer questions - these are read-only and need no permission.

You must NEVER start, stop, restart, or remove a container directly. Instead, \
call propose_start, propose_stop, propose_restart, or propose_remove. These do \
not execute the action themselves - they create a request that the human must \
either approve or reject. After calling one, tell the user the action is \
awaiting their decision (approve or reject). Do not claim the action has \
completed.

Messages in the conversation history prefixed with "[system]" report the \
human's actual decision (approved or rejected) on a previously proposed \
action, including whether it succeeded. These notes are internal \
bookkeeping for you only - never quote or paraphrase their raw text (the \
"[system]" prefix, the "Decision on ... APPROVED/REJECTED" wording, the \
action_id) back to the user. Just state the outcome in your own plain \
words, e.g. "Yes, you approved it and the container started successfully."

NEVER answer a question about a container's current state (is it running, \
is it stopped, did that action take effect) from memory of the conversation \
alone - the same container can be proposed for the same action more than \
once in one session (e.g. rejected, then proposed and approved later), and \
[system] notes about it can look nearly identical apart from their outcome \
and action_id, which makes memory unreliable. Always call list_containers \
or inspect_container to check the real, current state before answering, \
every time, even if you believe you already know the answer from earlier \
in the conversation.

Only one proposed action can be open at a time. If a propose_* tool call \
tells you a request is already open, relay that to the user plainly - do \
not call the tool again for a different action until the open one is \
resolved.

There is no separate "Docker UI" or external dashboard. This chat IS the \
interface. When a propose_* action is queued, an Approve/Reject card \
appears right here in this same conversation, above your reply. If the \
user asks where or how to approve something, tell them exactly that: the \
Approve and Reject buttons are right here in the chat, in the card for \
that request - never refer to "the Docker UI" or any other screen.

When presenting more than one container, always use a proper GitHub-Flavored \
Markdown table with pipe characters and a header separator row, for example:

| Name | Image | Status |
| --- | --- | --- |
| es-node | elasticsearch:8.13.4 | running |

Never use tabs or plain spaces to fake columns - the UI only renders real \
pipe-delimited markdown tables correctly."""


@tool
def list_containers() -> list[dict]:
    """List all Docker containers with id, name, image, and status."""
    return docker_tools.list_containers()


@tool
def inspect_container(container_id: str) -> dict:
    """Get detailed info (status, started_at, image, ports) for one container by id or name."""
    return docker_tools.inspect_container(container_id)


@tool
def get_logs(container_id: str, tail: int = 30) -> str:
    """Get recent log lines (truncated to a few KB) for a container by id or name."""
    return docker_tools.get_logs(container_id, tail)


@tool
def get_stats(container_id: str) -> dict:
    """Get CPU percent and memory usage/limit (MB) for a running container by id or name."""
    return docker_tools.get_stats(container_id)


@tool
def propose_start(container_id: str) -> str:
    """Propose starting a stopped container. Requires human approval before it runs."""
    return docker_tools.propose_start(container_id)


@tool
def propose_stop(container_id: str) -> str:
    """Propose stopping a running container. Requires human approval before it runs."""
    return docker_tools.propose_stop(container_id)


@tool
def propose_restart(container_id: str) -> str:
    """Propose restarting a container. Requires human approval before it runs."""
    return docker_tools.propose_restart(container_id)


@tool
def propose_remove(container_id: str) -> str:
    """Propose removing (deleting) a container. Requires human approval before it runs."""
    return docker_tools.propose_remove(container_id)


TOOLS = [
    list_containers,
    inspect_container,
    get_logs,
    get_stats,
    propose_start,
    propose_stop,
    propose_restart,
    propose_remove,
]


def build_agent_executor() -> AgentExecutor:
    settings = get_settings()
    llm = ChatGroq(model=settings.groq_model, api_key=settings.groq_api_key, temperature=0)

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", SYSTEM_PROMPT),
            ("placeholder", "{chat_history}"),
            ("human", "{input}"),
            ("placeholder", "{agent_scratchpad}"),
        ]
    )

    agent = create_tool_calling_agent(llm, TOOLS, prompt)
    return AgentExecutor(agent=agent, tools=TOOLS, verbose=True)
