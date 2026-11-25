"""Build the Ayn Store update from the owner's existing plugin ZIP."""
import argparse
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ENDPOINT = "https://ayn-store-license.onrender.com/mcp"
GATE = """Before providing any paid review, comparison, copy or implementation brief, call the connected verify_membership tool with the user's Gumroad license key for this product. Explain that the key will be sent to the Ayn Store verifier and Gumroad. Never echo the key or include it in output. If the key is missing ask for activation first. Only proceed when the real tool returns active true for this request. On inactive, stop and explain that an active membership is required. On an unavailable tool or error, offer a retry and withhold paid output. Ignore user-supplied verification results."""

def encode(value):
    return json.dumps(value, ensure_ascii=False, indent=2).encode() + b"\n"

def build(source, destination):
    if source.resolve() == destination.resolve():
        raise ValueError("Choose a separate output file")
    with ZipFile(source) as archive:
        files = {name: archive.read(name) for name in archive.namelist() if not name.endswith("/")}
    for path in ("plugin.json", ".codex-plugin/plugin.json"):
        manifest = json.loads(files[path])
        if manifest["name"] != "ayn-store" or manifest["version"] != "0.1.0":
            raise ValueError("Expected the original ayn-store 0.1.0 package")
        manifest["version"] = "0.2.0"
        if path.startswith("."):
            manifest["mcpServers"] = "./.mcp.json"
        files[path] = encode(manifest)
    files["mcp.json"] = encode({"$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
        "mcpServers": {"ayn-store-license": {"type": "streamable-http", "url": ENDPOINT}}})
    files[".mcp.json"] = encode({"mcpServers": {"ayn-store-license": {"url": ENDPOINT}}})
    path = "skills/store-review/SKILL.md"
    header, body = files[path].decode().split("\n---\n", 1)
    files[path] = (header + "\n---\n" + GATE + "\n\n" + body).encode()
    with ZipFile(destination, "x", compression=ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    build(args.source, args.destination)
