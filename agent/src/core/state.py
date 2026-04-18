"""Run state persistence: creates run directories and records status."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Dict

from src.shanghai_time import now_shanghai


class RunStateStore:
    """Run state store: manages run directories and their lifecycle status."""

    def create_run_dir(self, workspace: Path) -> Path:
        """Create a unique run directory.

        Args:
            workspace: Parent directory (typically runs/).

        Returns:
            Newly created run directory path.
        """
        timestamp = now_shanghai().strftime("%Y%m%d_%H%M%S_%f")[:18]
        suffix = uuid.uuid4().hex[:6]
        run_dir = workspace / f"{timestamp}_{suffix}"
        run_dir.mkdir(parents=True, exist_ok=True)
        (run_dir / "code").mkdir(exist_ok=True)
        (run_dir / "logs").mkdir(exist_ok=True)
        (run_dir / "artifacts").mkdir(exist_ok=True)
        return run_dir

    def save_request(
        self,
        run_dir: Path,
        prompt: str,
        context: Dict[str, Any],
        user_content: Any = None,
    ) -> Dict[str, Any]:
        """Save the user request.

        Args:
            run_dir: Run directory.
            prompt: User prompt (plain summary; safe to log).
            context: Context metadata.
            user_content: Optional OpenAI multimodal parts (same as API); omitted for text-only.

        Returns:
            Saved payload.
        """
        payload: Dict[str, Any] = {"prompt": prompt, "context": context}
        if user_content is not None:
            payload["user_content"] = user_content
        self._write_json(run_dir / "req.json", payload)
        return payload

    def mark_success(self, run_dir: Path) -> None:
        """Mark the run as successful.

        Args:
            run_dir: Run directory.
        """
        self._write_json(run_dir / "state.json", {"status": "success"})

    def mark_failure(self, run_dir: Path, reason: str) -> None:
        """Mark the run as failed.

        Args:
            run_dir: Run directory.
            reason: Failure reason.
        """
        self._write_json(run_dir / "state.json", {"status": "failed", "reason": reason})

    @staticmethod
    def _write_json(path: Path, data: Any) -> None:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
