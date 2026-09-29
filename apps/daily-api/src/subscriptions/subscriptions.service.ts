import { Injectable, Logger } from '@nestjs/common';
import { SubscribersRepository } from '../db/subscribers.repository.js';
import { MailService } from '../mail/mail.service.js';

export type SignupOutcome = 'submitted' | 'ignored';

@Injectable()
export class SubscriptionsService {
  private readonly log = new Logger(SubscriptionsService.name);

  constructor(
    private readonly subscribers: SubscribersRepository,
    private readonly mail: MailService,
  ) {}

  /**
   * The answer is the same whatever the address turns out to be, so the form
   * cannot be used to find out who is already subscribed.
   */
  async signup(email: string): Promise<SignupOutcome> {
    const { outcome, token } = await this.subscribers.signup(email);
    if (outcome === 'active') {
      this.log.log('signup for an address that is already active — no mail sent');
      return 'submitted'; // the answer never differs; the form is not a lookup
    }
    await this.mail.sendConfirmation(email, token);
    return 'submitted';
  }

  async confirm(token: string): Promise<boolean> {
    return this.subscribers.confirm(token);
  }

  async unsubscribe(token: string): Promise<boolean> {
    return this.subscribers.unsubscribe(token);
  }
}
