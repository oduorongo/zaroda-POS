// The text-message versions of the delivery emails. Kept short (one SMS is 160 characters) and in plain words;
// like the emails they never include the delivery code or a phone number - only a link to the page that shows it.

import { JobInfo, nairobiTime } from './delivery-email';

const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}.` : text);

export const smsJobOpen = (job: JobInfo, url: string) =>
  `Zaroda: delivery job from ${clip(job.shopName, 24)} to ${clip(job.dropoffSummary, 24)}. Send your price before ${nairobiTime(job.quoteDeadline)}: ${url}`;

export const smsNewQuote = (orderNumber: string, fee: number, url: string) => `Zaroda: a rider offered ${kes(fee)} to deliver your order ${orderNumber}. Choose a rider: ${url}`;

export const smsRiderChosen = (shopName: string, pickupArea: string, dropoffSummary: string, fee: number, url: string) =>
  `Zaroda: you got the delivery! ${clip(shopName, 20)}, ${clip(pickupArea, 20)} to ${clip(dropoffSummary, 20)}. ${kes(fee)} cash. Details: ${url}`;

export const smsPickedUp = (orderNumber: string, agreedFee: number | null, url: string) =>
  `Zaroda: order ${orderNumber} is on its way.${agreedFee !== null ? ` Pay the rider ${kes(agreedFee)} cash.` : ''} Give your delivery code only after you get your goods: ${url}`;
