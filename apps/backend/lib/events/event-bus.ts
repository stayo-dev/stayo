interface SSEClient {
  ownerId: string;
  hostelId?: string;
  scope: "hostel" | "portfolio";
  send: (data: any) => void;
}

const clients = new Set<SSEClient>();

export function addClient(client: SSEClient) {
  clients.add(client);
}

export function removeClient(client: SSEClient) {
  clients.delete(client);
}

export function broadcast(ownerId: string, event: any) {
  for (const client of Array.from(clients)) {
    if (client.ownerId !== ownerId) continue;
    if (event?.scope === "hostel" && client.scope === "hostel" && client.hostelId === event.hostelId) client.send(event);
    if (event?.scope === "portfolio" && client.scope === "portfolio") client.send(event);
  }
}
