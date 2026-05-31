"""Bounded, autonomous agentic harness built as a LangGraph DAG.

The graph (see ``graph.py``) plans, validates, executes, critiques, and composes
by LLM judgment, navigating its own edges until a terminal state. Mandatory
guardrails (max iterations/queries, total timeout, no-progress breaker, explicit
termination, and a hard recursion backstop) keep it bounded. The LLM reasoning
surface is an injectable port (``llm.Reasoner``) so the graph runs
deterministically under test; the LLM proposes but never authorizes.
"""
