type QueuedTransfer = {
  id: string;
  fileName?: string;
  queuedAt: number;
};

export class TransferRegistry {
  private transfers: QueuedTransfer[] = [];

  queueTransfer(input: { fileName?: string }) {
    const record = {
      id: `transfer-${Date.now()}`,
      fileName: input.fileName,
      queuedAt: Date.now()
    };
    this.transfers.unshift(record);
    return record;
  }
}