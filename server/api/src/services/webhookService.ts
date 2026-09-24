import * as crypto from 'crypto'

/**
 * In Phase 1, @adamant/db is handled by R2.
 * We stub the DB calls so Track 1 compiles and the workflow is established.
 */

export class WebhookService {
  static async processEvent(deliveryId: string, event: string, payload: any): Promise<void> {
    // 1. Check for duplicate deliveryId
    const isDuplicate = await this.checkDuplicate(deliveryId)
    if (isDuplicate) {
      throw new Error('Duplicate delivery')
    }

    // 2. Handle specific events
    switch (event) {
      case 'ping':
      case 'installation':
        await this.handleInstallation(deliveryId, payload)
        break
      case 'workflow_run':
        await this.handleWorkflowRun(deliveryId, payload)
        break
      case 'pull_request':
        await this.handlePullRequest(deliveryId, payload)
        break
      default:
        // Ignore unhandled events but save the delivery
        await this.saveDelivery(deliveryId, null)
        break
    }
  }

  private static async checkDuplicate(_deliveryId: string): Promise<boolean> {
    // TODO: Query webhook_deliveries table
    return false
  }

  private static async saveDelivery(deliveryId: string, runId: string | null): Promise<void> {
    // TODO: Insert into webhook_deliveries (delivery_id, run_id)
    console.log(`Saved delivery ${deliveryId} linked to run ${runId}`)
  }

  private static async handleInstallation(deliveryId: string, _payload: any): Promise<void> {
    // Upsert installations / repo_bindings
    console.log(`Handling installation for delivery ${deliveryId}`)
    await this.saveDelivery(deliveryId, null)
  }

  private static async handleWorkflowRun(deliveryId: string, payload: any): Promise<void> {
    if (payload.action !== 'completed') {
      await this.saveDelivery(deliveryId, null)
      return
    }
    if (payload.workflow_run.conclusion !== 'failure') {
      await this.saveDelivery(deliveryId, null)
      return
    }

    // Failed workflow_run -> queued run + graph_step
    const runId = crypto.randomUUID()
    console.log(`Creating run ${runId} for failed workflow_run`)
    
    // TODO: Insert runs (queued)
    // TODO: Enqueue graph_step in graphile-worker
    
    await this.saveDelivery(deliveryId, runId)
  }

  private static async handlePullRequest(deliveryId: string, payload: any): Promise<void> {
    if (payload.action !== 'closed' || !payload.pull_request.merged) {
      await this.saveDelivery(deliveryId, null)
      return
    }

    // If pr_number matches a run -> mark run 'merged'
    console.log(`Handling merged pull_request ${payload.pull_request.number}`)
    
    // TODO: Query runs where pr_number = payload.pull_request.number
    // TODO: If found, update run status to 'merged'
    // TODO: Else, just save delivery
    
    await this.saveDelivery(deliveryId, null)
  }
}
