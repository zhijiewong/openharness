"""Project onboarding — auto-detect language, framework, test runner, git state.

Mirrors Claude Code's projectOnboardingState.ts pattern.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class ProjectContext:
    """Detected project context."""

    root: Path
    language: str = "unknown"
    framework: str = ""
    package_manager: str = ""
    test_runner: str = ""
    has_git: bool = False
    git_branch: str = ""
    has_readme: bool = False
    has_rules: bool = False
    description: str = ""  # From README first line


# Detection rules: (indicator_file, language, framework, package_manager, test_runner)
_DETECTORS: list[tuple[str, str, str, str, str]] = [
    # Python
    ("pyproject.toml", "python", "", "pip", "pytest"),
    ("setup.py", "python", "", "pip", "pytest"),
    ("requirements.txt", "python", "", "pip", "pytest"),
    ("Pipfile", "python", "", "pipenv", "pytest"),
    ("poetry.lock", "python", "", "poetry", "pytest"),
    # JavaScript / TypeScript
    ("package.json", "javascript", "", "npm", "jest"),
    ("bun.lockb", "typescript", "", "bun", "bun test"),
    ("deno.json", "typescript", "", "deno", "deno test"),
    # Rust
    ("Cargo.toml", "rust", "", "cargo", "cargo test"),
    # Go
    ("go.mod", "go", "", "go", "go test"),
    # Java
    ("pom.xml", "java", "", "maven", "mvn test"),
    ("build.gradle", "java", "", "gradle", "gradle test"),
    # Ruby
    ("Gemfile", "ruby", "", "bundler", "rspec"),
    # PHP
    ("composer.json", "php", "", "composer", "phpunit"),
    # C# / .NET
    ("*.csproj", "csharp", ".NET", "dotnet", "dotnet test"),
    # Swift
    ("Package.swift", "swift", "", "swift", "swift test"),
]

# Framework detection (file indicator → framework name)
_FRAMEWORKS: dict[str, str] = {
    "next.config.js": "Next.js",
    "next.config.ts": "Next.js",
    "nuxt.config.js": "Nuxt",
    "nuxt.config.ts": "Nuxt",
    "vite.config.ts": "Vite",
    "vite.config.js": "Vite",
    "angular.json": "Angular",
    "svelte.config.js": "Svelte",
    "astro.config.mjs": "Astro",
    "remix.config.js": "Remix",
    "manage.py": "Django",
    "app.py": "Flask",
    "fastapi": "FastAPI",
    "Dockerfile": "Docker",
    "docker-compose.yml": "Docker Compose",
    "docker-compose.yaml": "Docker Compose",
    "tailwind.config.js": "Tailwind CSS",
    "tailwind.config.ts": "Tailwind CSS",
}


class ProjectDetector:
    """Auto-detect project type and generate context for the agent."""

    def detect(self, path: Path | None = None) -> ProjectContext:
        """Detect project context from the given path."""
        root = path or Path.cwd()

        language = "unknown"
        framework = ""
        package_manager = ""
        test_runner = ""

        # Check indicator files
        for indicator, lang, fw, pm, tr in _DETECTORS:
            if "*" in indicator:
                if list(root.glob(indicator)):
                    language, framework, package_manager, test_runner = lang, fw or framework, pm, tr
                    break
            elif (root / indicator).exists():
                language, framework, package_manager, test_runner = lang, fw or framework, pm, tr
                break

        # Detect framework
        for indicator_file, fw_name in _FRAMEWORKS.items():
            if (root / indicator_file).exists():
                framework = fw_name
                break

        # Check for specific Python frameworks in requirements/pyproject
        if language == "python":
            framework = _detect_python_framework(root) or framework

        # Git state
        has_git = (root / ".git").is_dir()
        git_branch = ""
        if has_git:
            head = root / ".git" / "HEAD"
            if head.is_file():
                ref = head.read_text(encoding="utf-8").strip()
                if ref.startswith("ref: refs/heads/"):
                    git_branch = ref[len("ref: refs/heads/"):]

        # README
        has_readme = any((root / name).is_file() for name in ("README.md", "README.rst", "README.txt", "README"))
        description = ""
        for readme_name in ("README.md", "README.rst", "README.txt", "README"):
            readme_path = root / readme_name
            if readme_path.is_file():
                lines = readme_path.read_text(encoding="utf-8", errors="replace").splitlines()
                for line in lines:
                    line = line.strip().lstrip("#").strip()
                    if line:
                        description = line[:200]
                        break
                break

        # Rules
        has_rules = (root / ".oh" / "RULES.md").is_file()

        return ProjectContext(
            root=root,
            language=language,
            framework=framework,
            package_manager=package_manager,
            test_runner=test_runner,
            has_git=has_git,
            git_branch=git_branch,
            has_readme=has_readme,
            has_rules=has_rules,
            description=description,
        )

    def generate_system_context(self, ctx: ProjectContext) -> str:
        """Generate system prompt additions from project detection."""
        parts: list[str] = []

        parts.append(f"Working directory: {ctx.root}")

        if ctx.language != "unknown":
            lang_info = f"Language: {ctx.language}"
            if ctx.framework:
                lang_info += f" ({ctx.framework})"
            parts.append(lang_info)

        if ctx.package_manager:
            parts.append(f"Package manager: {ctx.package_manager}")

        if ctx.test_runner:
            parts.append(f"Test command: {ctx.test_runner}")

        if ctx.has_git:
            git_info = "Git repository: yes"
            if ctx.git_branch:
                git_info += f" (branch: {ctx.git_branch})"
            parts.append(git_info)

        if ctx.description:
            parts.append(f"Project: {ctx.description}")

        if not parts:
            return ""

        return "# Environment\n" + "\n".join(f"- {p}" for p in parts)


def _detect_python_framework(root: Path) -> str:
    """Detect Python framework from dependency files."""
    check_files = ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"]
    for fname in check_files:
        fpath = root / fname
        if not fpath.is_file():
            continue
        try:
            content = fpath.read_text(encoding="utf-8").lower()
        except (OSError, UnicodeDecodeError):
            continue

        if "django" in content:
            return "Django"
        if "fastapi" in content:
            return "FastAPI"
        if "flask" in content:
            return "Flask"
        if "starlette" in content:
            return "Starlette"
        if "streamlit" in content:
            return "Streamlit"

    return ""
