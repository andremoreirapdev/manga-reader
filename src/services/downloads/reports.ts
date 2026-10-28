export function reportFailureReason(error: unknown): string {
  if (error && typeof error === "object") {
    if ("status" in error && typeof error.status === "number" && error.status >= 100 && error.status <= 599) {
      return `HTTP ${error.status}`;
    }

    if ("name" in error && error.name === "ReportTimeoutError") {
      return "Tempo limite (5 s)";
    }

    if ("name" in error && error.name === "ReportNetworkError") {
      return "Conexão/rede";
    }
  }

  return "Falha não identificada";
}
