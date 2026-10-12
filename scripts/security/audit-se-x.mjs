import { execFileSync } from "node:child_process";

const container = process.env.APEX_SEX_CONTAINER ?? "apex-se-x";
const network = process.env.APEX_SEX_NETWORK ?? "apex-search";

function run(command, args = []) {
  try {
    return { ok: true, output: execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() };
  } catch (error) {
    return { ok: false, output: String(error.stdout ?? error.stderr ?? error.message ?? error).trim() };
  }
}

function print(title, result) {
  console.log("\n=== " + title + " ===");
  console.log(result.output || "(no output)");
}

print("Dedicated network", run("docker", ["network", "inspect", network]));
print("Container network/privilege", run("docker", [
  "inspect", "--format={{.HostConfig.NetworkMode}} {{.HostConfig.Privileged}}", container
]));
print("Container mounts", run("docker", [
  "inspect", "--format={{json .Mounts}}", container
]));
print("Container tmpfs", run("docker", [
  "inspect", "--format={{json .HostConfig.Tmpfs}}", container
]));
print("Container capabilities/security", run("docker", [
  "inspect", "--format={{json .HostConfig.CapDrop}} {{json .HostConfig.SecurityOpt}}", container
]));
print("Listening sockets", run("ss", ["-tulpn"]));
print("Routing tables", run("ip", ["route", "show", "table", "all"]));
print("Policy routing", run("ip", ["rule", "show"]));
print("Network namespaces", run("lsns", ["-t", "net"]));
print("Interfaces", run("ip", ["-br", "addr", "show"]));
print("Docker networks", run("docker", ["network", "ls"]));
print("Container stats", run("docker", ["stats", "--no-stream", container]));

console.log("\n=== Production interpretation ===");
console.log("This is a point-in-time audit. It does not prove runtime behavior between snapshots.");
console.log("Do not unlock production from this output alone. Apply the host firewall, route, CA, storage, and egress tests and require zero unresolved critical findings.");
