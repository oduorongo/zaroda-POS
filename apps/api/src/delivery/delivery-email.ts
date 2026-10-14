// The emails around a delivery: to riders when a job opens and when they are chosen, and to the shopper when
// the first price arrives and when the goods are picked up. Plain, short, and each ends with one button.
// Nothing here ever includes the delivery code, a phone number or a full address - the emails only point
// at the pages that show them to the right person.

import { brandButton, brandedEmail } from '../common/email/brand-layout';

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`;

/** "3:45 PM" in Nairobi time, whatever time zone the server runs in. */
export const nairobiTime = (d: Date) => d.toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit' });

function frame(title: string, bodyHtml: string, buttonLabel: string, url: string, footnote?: string): string {
  return brandedEmail({
    title,
    bodyHtml:
      bodyHtml +
      `<p style="text-align:center;margin:24px 0 8px">${brandButton(buttonLabel, url)}</p>` +
      (footnote ? `<p style="font-size:12px;color:#64748b;margin:16px 0 0">${escapeHtml(footnote)}</p>` : ''),
  });
}

const p = (text: string) => `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(text)}</p>`;

export interface JobInfo {
  shopName: string;
  pickupArea: string;
  dropoffSummary: string;
  itemCount: number;
  quoteDeadline: Date;
}

/** To a rider who may quote on a new job. */
export function buildJobOpenEmail(riderName: string | null, job: JobInfo, url: string): BuiltEmail {
  const items = `${job.itemCount} ${job.itemCount === 1 ? 'item' : 'items'}`;
  return {
    subject: `New delivery job: ${job.shopName} to ${job.dropoffSummary}`,
    html: frame(
      'A delivery job is waiting for your price',
      p(`Hello${riderName ? ` ${riderName}` : ''},`) +
        p(`${job.shopName} needs a rider.`) +
        p(`Pick up: ${job.pickupArea}. Deliver to: ${job.dropoffSummary}. ${items}.`) +
        p(`Send your price before ${nairobiTime(job.quoteDeadline)}. The customer chooses a rider and pays the rider in cash on delivery.`),
      'See the job and send my price',
      url,
      "You are getting this because you are an approved Zaroda rider. Prices are sent from your rider page.",
    ),
    text: `New delivery job from ${job.shopName}. Pick up: ${job.pickupArea}. Deliver to: ${job.dropoffSummary}. ${items}. Send your price before ${nairobiTime(job.quoteDeadline)}: ${url}`,
  };
}

/** To the shopper when the first rider has offered a price. */
export function buildNewQuoteEmail(orderNumber: string, shopName: string, fee: number, deadline: Date, url: string): BuiltEmail {
  return {
    subject: `A rider will deliver your order ${orderNumber} for ${kes(fee)}`,
    html: frame(
      'A rider has offered a price',
      p(`${shopName} has your order ${orderNumber} ready for delivery, and a rider has offered to bring it for ${kes(fee)}.`) +
        p(`Open your order to see the offer and choose a rider${deadline ? ` before ${nairobiTime(deadline)}` : ''}. You pay the rider in cash when your goods arrive.`),
      'Choose a rider',
      url,
      'More riders may offer a price - you can wait and compare, or choose now.',
    ),
    text: `A rider offered to deliver your order ${orderNumber} (${shopName}) for ${kes(fee)}. Choose a rider before ${nairobiTime(deadline)}: ${url}`,
  };
}

/** To the rider the customer picked. */
export function buildRiderChosenEmail(riderName: string | null, shopName: string, pickupArea: string, dropoffSummary: string, fee: number, url: string): BuiltEmail {
  return {
    subject: `You were chosen: deliver for ${shopName} (${kes(fee)})`,
    html: frame(
      'You got the delivery',
      p(`Hello${riderName ? ` ${riderName}` : ''}, the customer chose you.`) +
        p(`Collect from: ${shopName}, ${pickupArea}. Deliver to: ${dropoffSummary}.`) +
        p(`You agreed ${kes(fee)}, paid to you in cash by the customer. Ask for their 4-digit code when you hand over the goods - you need it to finish the delivery.`),
      'Open my deliveries',
      url,
      "The customer's phone number and full address are on your rider page.",
    ),
    text: `You were chosen to deliver for ${shopName} for ${kes(fee)} cash. Collect from ${pickupArea}, deliver to ${dropoffSummary}. Details and the customer's phone: ${url}`,
  };
}

/** To the shopper when the rider has the goods. */
export function buildPickedUpEmail(orderNumber: string, shopName: string, agreedFee: number | null, url: string): BuiltEmail {
  return {
    subject: `Your order ${orderNumber} is on its way`,
    html: frame(
      'Your order is on its way',
      p(`The rider has collected your order ${orderNumber} from ${shopName}.`) +
        (agreedFee !== null ? p(`Pay the rider ${kes(agreedFee)} in cash when your goods arrive.`) : '') +
        p('Give the rider your 4-digit delivery code only AFTER you have received your goods. It confirms the delivery.'),
      'See my delivery code',
      url,
    ),
    text: `Your order ${orderNumber} from ${shopName} is on its way.${agreedFee !== null ? ` Pay the rider ${kes(agreedFee)} cash on arrival.` : ''} Give the rider your delivery code only after you have received your goods: ${url}`,
  };
}
