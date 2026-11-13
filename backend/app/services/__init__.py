"""Domain operations shared by the HTTP routers and the MCP tools.

A service takes a session, the authenticated subject and typed Pydantic input. It never commits (the caller owns
the transaction: one commit per HTTP request, one per MCP call or batch), knows nothing of HTTP, and refuses with
``ServiceError`` so both transports report the same failure with the same code. A module here never imports from
``routers/``.
"""
