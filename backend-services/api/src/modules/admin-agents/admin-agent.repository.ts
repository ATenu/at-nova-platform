import { A2aAgentRegistration } from '@nova/database';
import type { DataSource, Repository } from 'typeorm';

/**
 * Read + pure-metadata access to the A2A agent registry from the control plane.
 * Onboarding (which requires the native A2A card fetch) is delegated to the
 * orchestrator; Node owns the schema and performs only metadata mutations
 * (enable/disable/remove of admin-source rows) directly here — no extra hop for
 * operations that need no A2A protocol.
 */
export class AdminAgentRepository {
  private readonly agents: Repository<A2aAgentRegistration>;

  constructor(dataSource: DataSource) {
    this.agents = dataSource.getRepository(A2aAgentRegistration);
  }

  /** All registrations, newest registration first (stable, bounded set). */
  async list(): Promise<A2aAgentRegistration[]> {
    return this.agents.find({ order: { registeredAt: 'DESC' } });
  }

  async findByName(name: string): Promise<A2aAgentRegistration | null> {
    return this.agents.findOne({ where: { name } });
  }

  /** Set the enabled flag and mirror the displayed lifecycle status. */
  async setEnabled(name: string, enabled: boolean): Promise<void> {
    await this.agents.update(
      { name },
      { enabled, status: enabled ? 'onboarded' : 'disabled' },
    );
  }

  async remove(name: string): Promise<void> {
    await this.agents.delete({ name });
  }
}
