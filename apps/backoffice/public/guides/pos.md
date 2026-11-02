# Zaroda POS: user guide

Zaroda POS runs a Kenyan shop: the till, stock, suppliers, customers, staff, money, tax (including KRA eTIMS) and, if you want it, an online shop with delivery by riders.
It has three parts:
- **The back office** (on a computer, tablet or phone): set up the shop, manage products and stock, see reports, run the books.
- **The till** (on any tablet or phone at the counter): sell, take M-Pesa or cash, open and close shifts, do returns.
- **The online shop** (optional): your shop on the Zaroda marketplace with its own link, where buyers order and pay by M-Pesa.

---

## Who can do what

Everyone who works in the shop is added under **Staff** with a **role**:

| Role | Where they work | What they can do |
|---|---|---|
| **Cashier** | The till only (signs in with a PIN) | Sell, take payments, open and close their shift |
| **Supervisor** | The till (PIN) | Everything a cashier does, plus approve discounts and refunds |
| **Manager** | Back office and till | Run the shop: products, stock, suppliers, staff, reports, money |
| **Owner** | Back office and till | Everything, including closing the books and settings only the owner may change |
| **Auditor** | Back office | Look at everything, change nothing |

Cashiers and supervisors never sign in to the back office; they use their **PIN** at the till.

---

## Getting started

### 1. Create your account
Sign up on **zarodashop.com** with your business name, the **kind of business** (shop, restaurant, pharmacy, salon, hotel and others), your name, email and a password, and your first branch. You start on a **14-day free trial**; no card is needed.

### 2. Sign in to the back office
Sign in with your email and password. **Home** shows a tile for every screen you use; the top menu has the ones you use most. Every page has **← Back** at the top left.

### 3. Set up the basics (in this order)
1. **Branches**: each shop location, with its county (needed for delivery). Each branch has its **terminals** (the tablets or phones used as tills).
2. **Tax Settings**: your VAT rates and tax classes, so every product is taxed correctly.
3. **Categories** and **Products**: what you sell (see below).
4. **Staff**: everyone who will sell, with their role and PIN.
5. **Inventory**: your opening stock in each branch.
6. **The till**: set up each tablet or phone as a till (see **The till**).

---

## Products and categories

### Add a product
On **Products**, tap **New product** and enter:
- the **name**, **category** and **tax class** (VAT rate);
- whether it is **sold by count** (pieces) or **sold by weight/volume** (kg, litres, with decimals);
- the **selling price** and the **cost** (what you pay for it). The cost is used for your profit; it updates by itself to the average price paid when you enter the price while receiving stock;
- its **barcode**, if it has one.

### Options (sizes, packs, colours)
A product can have several **options**, each with its own name (*500 ml*, *1 litre*; *Single*, *Carton of 12*), price, cost, barcode and stock. At the till each option shows by its readable name.

### Barcodes and labels
- Scan or type a product's barcode on the product. Two products cannot share a barcode.
- **Barcode labels**: choose the products and how many labels of each, then print. A product with no barcode (bread, repacked goods, food you make) can be given one of your own. In the print window choose your label printer, set margins to **None** and scale to **100%**.

### Export
**Export CSV** downloads your product list as a spreadsheet.

---

## Stock (inventory)

### Stock levels
**Inventory** shows the stock of every product in each branch. Choose the branch at the top.

### Adjusting stock
Record a change with its reason: **adjustment** (found or lost stock), **transfer** (moved between branches), **stock take** or **return**. Type the change as a plus or minus number (decimals are fine for items sold by weight). When stock comes in, enter the **price paid** too and the product's cost updates.

### Batches and expiry
Products with expiry dates (food, medicine) can be kept in **batches**, each with its expiry date. The till picks the batch to sell from.

### Stock count
**Stock count** is for counting your shelves: walk round, **scan** each item (each scan counts one more; with a scanner gun you can just keep scanning), and when you finish, any difference between what you counted and what the system expected is corrected in your stock.

### Repackaging (breaking bulk)
**Repackaging** turns bulk stock into sellable units: for example a 50 kg sack of sugar into fifty 1 kg packets. The bulk stock goes down and the packets go up.

### Waste
**Waste** writes off damaged or expired stock, with the reason. It comes out of stock and shows in your reports and profit.

### Oversells
If a till sold more than the system thought you had (for example while offline), it shows under **stock conflicts** on Inventory so you can check and correct it.

---

## Buying from suppliers

### Suppliers
On **Suppliers**, add each supplier with their contacts, **payment terms** (how many days you have to pay) and **KRA PIN** (so their eTIMS invoices can be matched to them).

### Purchase orders
1. **Purchase Orders → New purchase order**: choose the supplier and branch and add the items with quantities and prices.
2. When the goods arrive, open the order and **receive** them: enter what actually came (part deliveries are fine) and anything **damaged**. Received goods go into stock at the price paid.
3. Tick **Record what we now owe** to make the **supplier bill** at the same time, with the supplier's invoice number, the **VAT** on it and its **eTIMS invoice number**.

Every delivery gets a **goods received note** you can print (**Goods received**).

### Supplier bills
**Supplier bills** shows what you owe each supplier and how late it is. Record a **payment** (cash, M-Pesa, bank or cheque) or a **credit note** (damaged goods, a price correction). **Add a bill** for an invoice that did not come with a delivery.

To claim the VAT on a bill from KRA, it needs the supplier's **KRA PIN** and the **eTIMS invoice number**, or to be linked to the invoice KRA holds (see **KRA eTIMS**). Otherwise the VAT is treated as a cost.

---

## The till

### Set up a till (once per device)
Open the till app on the tablet or phone, choose **Set up this till**, sign in with an owner or manager email, and choose which **terminal** this device is. From then on, staff sign in with their PIN.

### Start a shift
"**Who's selling?**": the cashier taps their **PIN**. If no shift is open on this till, they open one with the **opening float** (the cash in the drawer at the start).

### Make a sale
1. **Search** a product by name or code, or **scan** its barcode. Tap to add it to the **cart**; change quantities there (weighed items take decimals). If the product has batches, choose the batch.
2. Add the **customer** if you like (search by name or phone, or add a new one) so they earn **loyalty points** and the sale is on their record. They can **redeem points** to pay part of the sale.
3. A **discount** needs a supervisor (or above) to approve it on the till.
4. **Payment**:
   - **Cash**: enter the amount tendered and the till shows the change.
   - **M-Pesa**: enter the customer's Safaricom number and an M-Pesa prompt goes to their phone. When they enter their PIN the sale completes by itself ("M-Pesa payment confirmed"). If nothing comes, ask them to check their phone or try again.
   - **Charge to room** (hotels): the amount goes on the guest's bill, paid at check-out.
5. The receipt shows; print it or start the next sale.

### Working offline
If the internet drops, the till keeps selling for **cash**: sales are saved on the device and sent automatically when the connection is back ("Syncing..."). M-Pesa, customer lookup, charging to a room and pharmacy prescription checks need a connection.

### Returns
**Returns** refunds a sale: find the sale, enter the **refund amount** (up to what is left to refund) and the reason, and a **supervisor (or above) approves** it. The stock and the money are corrected.

### End a shift
**End shift** shows the live **X-report**: sales completed and the **expected cash in the drawer**. Count the cash, enter the **cash counted**, and close: the **Z-report** is recorded with any difference (variance). The back office keeps every shift under **Shifts**.

---

## Sales, customers and layaways

- **Sales**: every sale with its total and status. Open one to see its lines and payments, reprint the receipt or the KRA receipt, and see any refunds.
- **Customers & Loyalty**: customer records, their purchase history and loyalty points. A customer can have a **KRA PIN**, which is printed on their receipts and sent to KRA with their sales.
- **Layaways**: a customer pays for goods in parts. **New layaway** records the goods and the total; each part-payment is recorded until it is paid in full and the goods are handed over.

---

## Staff, roster and payroll

- **Staff**: **Add person** with their name, role, PIN (and email and password for back-office roles), and the branch they work in (blank for all branches).
- **Roster**: plan who works which shift, and review it.
- **Payroll**: pay runs for your staff with the statutory deductions (PAYE, NSSF, SHIF and the Housing Levy) worked out, and the payment history.

---

## Money and reports

### Reports
**Reports** shows your sales **by product**, **by branch**, **by cashier** and **by hour**, plus **waste**, for any dates.

### Profit & loss
**Profit & loss** is what you really made: sales (less the tax in them and refunds), less the cost of what you sold, waste, expenses and payroll, **by day, week or month**. Lines with no cost are flagged so you can add the cost.

### Expenses
**Expenses** records money you spend (rent, power, transport, supplies...): the category, amount, how it was paid and the date. If it has VAT on a supplier's eTIMS receipt, enter the VAT, their **KRA PIN** and the **eTIMS invoice number** so you can claim it.

### Accounts (the books)
**Accounts** is a full set of double-entry books that **keep themselves**: sales, refunds, expenses, supplier bills and payments, stock counts, waste, payroll and more are posted for you every few minutes.
- **Statements**: profit and loss (for the whole business or one branch), balance sheet, trial balance, **cash flow**, **aged debtors**, **aged creditors** and the monthly **VAT return** with the purchases list for iTax. Each downloads as a spreadsheet.
- **What you owe**: VAT, PAYE, NSSF, SHIF, the Housing Levy and staff tips held; record each payment here.
- **Journals** for opening balances and corrections, the **chart of accounts**, each **account's ledger**, and **closing a period** (owner only).

---

## KRA eTIMS

Under **Settings → eTIMS** (once your business has its eTIMS details from KRA):
- **Connect** each branch to KRA.
- **Products and KRA**: give each product its KRA item class and register it with KRA. A sale with an unregistered product waits until it is registered.
- **Send sales**: switch it on and every sale and refund is sent to KRA by itself. **Sales sent to KRA** shows each one and anything KRA refused, with the reason. A sale's **KRA receipt** (with KRA's signature and QR code) can be printed from the sale.
- **Purchases**: download the invoices your suppliers sent you through eTIMS, match them to your products and confirm them, and **link** each to its supplier bill or expense so its VAT is claimable.
- **Reports**: the X and Z reports, items sold and closing stock, as KRA asks for.
- **From KRA**: notices, imported items, and checking a customer's KRA PIN.

---

## Online shop (add-on)

Ask Zaroda to switch the online shop on, then set it up under **Online Shop**:
1. Your **shop link** (lowercase letters, numbers and hyphens; changing it breaks links you have already shared).
2. **Payments**: connect your own M-Pesa (Tuma, or your own Paybill/Till). Buyers pay **you** directly.
3. The **branch that fulfils online orders**: online stock comes from it, and buyers collect pickup orders there.
4. **Pickup and delivery**, and the **counties you deliver to**.
5. Mark which **products** are online, with photos and descriptions.

Your shop appears on the Zaroda marketplace and at its own link. Buyers sign in with their phone, order and pay by M-Pesa.

### Online orders
**Online Orders**: **accept** a paid order, **prepare** it, and hand it over (pickup, or delivery by a rider). Delivery is by your own riders or Zaroda's approved riders, who quote a delivery fee the buyer accepts and are paid cash on delivery.

### The shopper's convenience fee
Buyers pay a small **convenience fee** (3%) added at checkout; your shop pays no commission on online orders. You collect it with the payment and send the day's total to Zaroda from **Online Shop** (it is invoiced each evening). If it is not sent within 3 days your online shop is hidden until it is; the till and back office keep working.

---

## Screens for your kind of business

When you sign up you choose your kind of business, and its own screens appear on **Home** and in the top menu:

| Business | Extra screens |
|---|---|
| **Restaurant** | Tables & Kitchen (table status, kitchen tickets on a kitchen screen), open bills, QR table ordering |
| **Hotel** | Front desk (arrivals, in-house guests, departures, check-in and check-out), rooms and housekeeping, rate plans, night audit and hotel reports; optionally the restaurant |
| **Pharmacy** | Prescription-flagged sales and stock |
| **Salon** | Bookings (appointments and who does them) |
| **Manufacturing** | Production runs and recipes |
| **Service business** | Job orders and their status |
| **School supplier** | Schools, school price lists, school orders and deliveries, invoices and payments, quotes, tenders, contracts and cash flow |

Landlords use **ZARODA RENTALS** and contractors use **Zaroda Build**: each has its own site and its own user guide.

---

## Your Zaroda plan

Each plan covers a number of **tills (devices)** and **branches**. After the free trial, Zaroda invoices your plan and you pay by M-Pesa. Some add-ons (like the online shop) are separate. Ask Zaroda to change your plan.

---

## Common questions

**A cashier cannot sign in to the back office.** That is on purpose: cashiers and supervisors use their PIN at the till. Give someone the Manager role if they need the back office.

**The till says it is offline.** Keep selling for cash; the sales send themselves when the connection is back. For M-Pesa, wait for the connection.

**The M-Pesa prompt did not arrive.** Check the number, ask the customer to unlock their phone, and try again. If it still fails, take cash.

**The drawer is short or over at the end of the shift.** The Z-report records the variance. Check **Shifts** and the shift's sales.

**My profit looks wrong.** Look for products with no cost (they are flagged on Profit & loss) and add their cost.

**Stock is wrong after a busy day.** Check **stock conflicts** on Inventory, then do a **Stock count** for the items in question.

**A sale is not showing at KRA.** Open **Settings → eTIMS → Sales sent to KRA**: a sale waits if a product in it is not registered with KRA, and anything KRA refused shows its reason.

**Where do I get help?** Contact Zaroda Solutions from zarodashop.com.
