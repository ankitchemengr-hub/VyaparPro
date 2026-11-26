// What each page does — shown by the ⓘ in the top bar (app-layout.tsx),
// which follows the page you're on. Keep these to what the page really does.
export interface PageInfo { title: string; text: string }

const INFO: Record<string, PageInfo> = {
  "/": { title: "Dashboard", text: "Today's sales, collections, dues (You Will Get / You Will Give), stock alerts and charts at a glance. Settings → Dashboard picks which charts show." },
  "/menu": { title: "Menu", text: "Every module you can open. Type in the search bar to find one; tap ⓘ on a tile to see what it does." },
  "/billing": { title: "Billing", text: "Make a GST or Non-GST bill, quotation, delivery challan or sale order: pick the customer, add items (rate, discount, GST), take payment, then print or share on WhatsApp. Also used to edit a bill or convert a quotation." },
  "/invoices": { title: "Invoices", text: "All bills in one list — filter by date (Today / 7 days / this month), type and status; open a bill to view, print, edit, take payment or cancel it." },
  "/quotations": { title: "Quotations", text: "All quotations. Make a new one, open one to print or share, and convert it into a bill when the customer confirms." },
  "/sales-return": { title: "Sales Return", text: "New Return: search the bill, pick the items and qty coming back — stock goes up and the customer gets credit. Return History: past returns and their credit notes." },
  "/inventory": { title: "Inventory", text: "Your products and services: add or edit an item (price, GST, HSN/SAC, unit, image), and see the current stock of each." },
  "/item-register": { title: "Item Register", text: "Pick one item and a date range to see every purchase, sale and stock adjustment of it, with totals and the stock available." },
  "/brands": { title: "Brands", text: "The brand list used when adding products — add, rename or delete a brand so names stay the same everywhere." },
  "/stock-adjustment": { title: "Stock Adjustment", text: "Adjust Stock: enter the physical count of an item; the difference is applied to stock. Report: past adjustments date-wise and product-wise." },
  "/customers": { title: "Customers", text: "All customers and suppliers: add or edit a party (mobile, GSTIN, address), see their balance and open their ledger." },
  "/customers/inactive": { title: "Inactive Customers", text: "Customers who haven't ordered in a while — call or WhatsApp them and note what they said." },
  "/khatabook": { title: "Khatabook", text: "Customer and Supplier balances. Open a party to see their ledger, receive or give money, add an adjustment, view receipts and send a WhatsApp reminder." },
  "/supplier-settle": { title: "Supplier Settle", text: "For each supplier: how much of their material you sold, how much money came in for it, and what you can pay them now from the cash you have." },
  "/stock-investment": { title: "Stock Investment", text: "Money that came back from each item sold, plus a share of its profit — and how much stock that buys again at the last purchase rate." },
  "/payments": { title: "Payments", text: "Payments received from customers. Filter Today / Week / Month; log a payment; approve or reject a salesman's pending payment; View, Edit or Delete a payment (Edit/Delete also fix the bills, balance and Cash Book)." },
  "/commission": { title: "Commission", text: "Salesman commission: Summary per salesman, Report by item, every Transaction, and Payment History. Admin marks commission paid." },
  "/cashbook": { title: "Cash Book", text: "Every cash, UPI and bank movement. Collect cash from salesmen, add money in / out, transfer between accounts and print receipts." },
  "/accounts": { title: "Accounts", text: "Your cash, UPI and bank accounts with their balances. Every payment you deposit is counted in one of these." },
  "/rewards": { title: "Rewards", text: "Volume reward schemes for customers (buy X litres, get a reward) and each customer's progress; mark a reward given." },
  "/material-received": { title: "Production Received", text: "Goods that came in from manufacturing (not a purchase): stock goes up and raw materials are reduced as per the BOM." },
  "/manufacturing": { title: "Manufacturing", text: "Workload (low-stock items to make), Assemble Item from its BOM, Ready Material to dispatch, Material Transfer slips and the production Report." },
  "/bom": { title: "Bill of Materials", text: "The recipe of each product you make: which raw materials and how much go into one batch. Assembly uses it to reduce raw material stock." },
  "/auto-manufacture": { title: "Auto Manufacturing", text: "Products you make never go into negative stock on sale — the shortfall is assembled from the BOM automatically. Also fixes products already negative." },
  "/purchases": { title: "Purchases", text: "New Purchase: enter a supplier's bill (items, GST, payment) — stock goes up. Purchase History: every purchase bill with dues; view, edit, print or export." },
  "/workers": { title: "Workers", text: "Daily workers: add a worker with their daily wage, mark attendance, and see each worker's ledger and payments." },
  "/expenses": { title: "Expenses", text: "Daily expenses by category (rent, electricity, transport, salary…), with the account it was paid from, and an expense report." },
  "/reports": { title: "Reports", text: "Sales, item-wise, customer-wise, GST, production, P&L, bill-wise profit, ledger and audit reports — open a card, pick dates, print or export." },
  "/books-audit": { title: "Books & Audit", text: "Accounting books: Trial Balance, P&L, Balance Sheet, Day Book, Journal, Contra, Debit Notes, GSTR-1, Bank Reconciliation, cheques, audit trail and Tally import / export." },
  "/price-list": { title: "Price List", text: "Change the selling price of many products at once, then save all changes together." },
  "/users": { title: "User Accounts", text: "Logins for your staff: add or edit a user and give each a role (accountant, salesman, store…)." },
  "/settings": { title: "Settings", text: "Bill numbering, role permissions, printing and bill layout, company logo, dashboard charts, Non-GST data cleanup and data import." },
  "/backup-restore": { title: "Backup & Restore", text: "Download a backup of all your data, set automatic backups, restore from a backup file, or reset the company to start fresh." },
  "/payment-sync": { title: "Bill Payment Sync", text: "Marks bills as paid when the party balance shows they're already settled (payment taken in Khatabook / Cash Book, advance or sales return). Preview first, then apply." },
  "/recycle-bin": { title: "Recycle Bin", text: "Cancelled bills. Review them or delete one for good — that doesn't change stock or ledger entries it already made." },
  "/subscriptions": { title: "Platform Console", text: "For the platform owner: every company's subscription, analytics, alerts, domain requests, demo leads, notices, plans & offers and Refer & Earn." },
  "/customer-orders": { title: "Customer Orders", text: "New Order takes an order (customer first, then items). Pending Orders lists open orders; tap one to open it like a bill." },
  "/salesman-dashboard": { title: "My Dashboard", text: "Your commission — pending, paid and total earned — and your recent commission entries." },
  "/my-orders": { title: "My Orders", text: "Your orders / bills with their totals and what is still to be paid." },
  "/my-statement": { title: "My Statement", text: "Your account: every bill and payment with the running balance." },
  "/catalog": { title: "Catalog", text: "Browse products with price and stock, add them to a cart and place an order." },
  "/my-account": { title: "My Account", text: "Change your password and login email, and sign out other devices." },
};

export function pageInfoFor(path: string): PageInfo | null {
  if (INFO[path]) return INFO[path];
  // /customers/12, /invoices/34 … fall back to the section's info.
  const base = Object.keys(INFO).filter((k) => k !== "/" && path.startsWith(k + "/")).sort((a, b) => b.length - a.length)[0];
  return base ? INFO[base] : null;
}
