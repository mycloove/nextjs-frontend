export function safeNextPath(path: string | null | undefined) {
  if (path && path.startsWith("/") && !path.startsWith("//")) return path;
  return "/";
}
