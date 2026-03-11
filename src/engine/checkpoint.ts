import { JjOperations } from "../jj/operations";
import { StateDB, type Checkpoint } from "../state";
import { logger } from "../util/logger";

/**
 * Creates and manages rollback checkpoints using jj's operation log.
 * Each checkpoint records a jj operation ID that can be restored later.
 */
export class CheckpointManager {
  constructor(
    private jj: JjOperations,
    private state: StateDB
  ) {}

  /** Create a checkpoint at the current operation. */
  async create(description = ""): Promise<Checkpoint> {
    const opId = await this.jj.currentOperationId();
    const checkpoint = this.state.createCheckpoint(opId, description);
    logger.info(`Checkpoint #${checkpoint.id} created at operation ${opId}`, {
      description,
    });
    return checkpoint;
  }

  /** Roll back to a checkpoint by restoring its operation. */
  async rollback(checkpointId: number): Promise<void> {
    const checkpoint = this.state.getCheckpoint(checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint #${checkpointId} not found`);
    }

    logger.warn(`Rolling back to checkpoint #${checkpointId}`, {
      operationId: checkpoint.operationId,
      description: checkpoint.description,
    });

    await this.jj.operationRestore(checkpoint.operationId);
  }

  /** List recent checkpoints. */
  list(limit = 20): Checkpoint[] {
    return this.state.listCheckpoints(limit);
  }
}
