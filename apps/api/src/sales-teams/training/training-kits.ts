/** Sample data for sales team training businesses, one kit per business type. Prices in KES. */

export interface KitProduct {
  name: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  unit?: string;
  schoolPrice?: number;
}

export interface Kit {
  industryType: string;
  label: string;
  businessName: string;
  ownerName: string;
  branchName: string;
  county: string;
  products: KitProduct[];
  customers: string[];
  salesPerDay?: [number, number];
}

const p = (name: string, category: string, price: number, cost: number, stock: number, extra: Partial<KitProduct> = {}): KitProduct => ({ name, category, price, cost, stock, ...extra });

export const TRAINING_KITS: Kit[] = [
  {
    industryType: 'RETAIL',
    label: 'Retail shop',
    businessName: 'Duka Bora Supermarket',
    ownerName: 'Grace Achieng',
    branchName: 'Rongo Town',
    county: 'Migori',
    salesPerDay: [6, 12],
    products: [
      p('Unga wa Ugali 2kg', 'Flour', 190, 165, 80),
      p('Sugar 1kg', 'Groceries', 180, 158, 60),
      p('Cooking Oil 1L', 'Groceries', 330, 290, 40),
      p('Rice Pishori 2kg', 'Groceries', 420, 360, 30),
      p('Milk 500ml', 'Dairy', 65, 52, 48),
      p('Bread 400g', 'Bakery', 65, 55, 30),
      p('Bar Soap 800g', 'Household', 210, 175, 36),
      p('Washing Powder 1kg', 'Household', 260, 215, 24),
      p('Tea Leaves 250g', 'Groceries', 150, 120, 40),
      p('Soda 500ml', 'Drinks', 70, 50, 96),
      p('Drinking Water 1L', 'Drinks', 60, 38, 72),
      p('Toilet Paper 10-pack', 'Household', 450, 380, 20),
    ],
    customers: ['Mama Otieno', 'John Kamau', 'Beatrice Atieno', 'Peter Ochieng', 'Lucy Wambui'],
  },
  {
    industryType: 'RESTAURANT',
    label: 'Restaurant',
    businessName: 'Ladha Tamu Restaurant',
    ownerName: 'Samuel Odhiambo',
    branchName: 'Main Restaurant',
    county: 'Kisumu',
    salesPerDay: [8, 15],
    products: [
      p('Ugali Beef Stew', 'Mains', 350, 160, 200, { unit: 'plate' }),
      p('Pilau Beef', 'Mains', 400, 180, 200, { unit: 'plate' }),
      p('Tilapia Fry with Ugali', 'Mains', 650, 330, 200, { unit: 'plate' }),
      p('Chapati (2 pcs)', 'Sides', 60, 25, 300, { unit: 'plate' }),
      p('Kachumbari', 'Sides', 80, 30, 300, { unit: 'plate' }),
      p('Chips Masala', 'Snacks', 250, 100, 200, { unit: 'plate' }),
      p('Samosa Beef', 'Snacks', 50, 20, 300),
      p('Tea with Milk', 'Drinks', 60, 20, 400, { unit: 'cup' }),
      p('Fresh Passion Juice', 'Drinks', 150, 60, 200, { unit: 'glass' }),
      p('Soda 300ml', 'Drinks', 60, 38, 120),
    ],
    customers: ['Walk-in', 'Ochieng Family', 'Kisumu Teachers Sacco', 'Faith Akinyi'],
  },
  {
    industryType: 'PHARMACY',
    label: 'Pharmacy',
    businessName: 'Afya Bora Chemist',
    ownerName: 'Dr. Mercy Njeri',
    branchName: 'Town Centre',
    county: 'Nairobi',
    salesPerDay: [5, 10],
    products: [
      p('Paracetamol 500mg (10 tabs)', 'Pain relief', 50, 25, 200),
      p('Ibuprofen 400mg (10 tabs)', 'Pain relief', 80, 40, 150),
      p('Amoxicillin 500mg (21 caps)', 'Antibiotics', 350, 210, 60),
      p('Cough Syrup 100ml', 'Cold & flu', 280, 170, 40),
      p('ORS Sachet', 'First aid', 30, 15, 120),
      p('Vitamin C 1000mg (10 tabs)', 'Supplements', 250, 150, 50),
      p('Antacid Tablets (20)', 'Digestive', 150, 85, 60),
      p('Bandage Roll', 'First aid', 120, 60, 40),
      p('Hand Sanitizer 500ml', 'Hygiene', 300, 190, 30),
      p('Malaria Test Kit', 'Tests', 200, 110, 30),
    ],
    customers: ['Walk-in', 'James Mwangi', 'Rose Wanjiru', 'Kevin Otieno'],
  },
  {
    industryType: 'SALON',
    label: 'Salon',
    businessName: 'Urembo Hair & Beauty',
    ownerName: 'Esther Wairimu',
    branchName: 'Main Salon',
    county: 'Nakuru',
    salesPerDay: [4, 9],
    products: [
      p('Haircut (Men)', 'Services', 300, 0, 9999, { unit: 'service' }),
      p('Braiding (Box braids)', 'Services', 2500, 600, 9999, { unit: 'service' }),
      p('Wash & Blow-dry', 'Services', 800, 150, 9999, { unit: 'service' }),
      p('Manicure', 'Services', 600, 120, 9999, { unit: 'service' }),
      p('Pedicure', 'Services', 900, 180, 9999, { unit: 'service' }),
      p('Relaxer Treatment', 'Services', 1500, 450, 9999, { unit: 'service' }),
      p('Hair Oil 250ml', 'Products', 450, 280, 30),
      p('Shampoo 500ml', 'Products', 650, 400, 24),
      p('Braids Extension Pack', 'Products', 350, 220, 60),
    ],
    customers: ['Ann Muthoni', 'Carol Adhiambo', 'Diana Chebet', 'Joyce Nyambura', 'Brian Kiprop'],
  },
  {
    industryType: 'HOTEL',
    label: 'Hotel / lodge',
    businessName: 'Lake View Lodge',
    ownerName: 'Daniel Omondi',
    branchName: 'Lake View Lodge',
    county: 'Homa Bay',
    salesPerDay: [5, 10],
    products: [
      p('Full Breakfast', 'Restaurant', 600, 250, 200, { unit: 'plate' }),
      p('Lunch Buffet', 'Restaurant', 1200, 500, 200, { unit: 'plate' }),
      p('Fish Dinner', 'Restaurant', 1100, 480, 200, { unit: 'plate' }),
      p('Coffee', 'Bar', 200, 60, 400, { unit: 'cup' }),
      p('Beer 500ml', 'Bar', 300, 190, 120),
      p('Soda 300ml', 'Bar', 100, 38, 120),
      p('Bottled Water 1L', 'Bar', 120, 38, 120),
      p('Laundry (per bag)', 'Services', 500, 100, 9999, { unit: 'service' }),
    ],
    customers: ['Walk-in', 'Mr. & Mrs. Kariuki', 'Homa Bay County Office', 'Tom Were'],
  },
  {
    industryType: 'SCHOOL_SUPPLIER',
    label: 'School supplier',
    businessName: 'Elimu Supplies Ltd',
    ownerName: 'Joseph Onyango',
    branchName: 'Main Store',
    county: 'Migori',
    salesPerDay: [3, 7],
    products: [
      p('Exercise Book 96pg (dozen)', 'Stationery', 540, 420, 100, { schoolPrice: 500 }),
      p('Ball Pen Blue (box of 50)', 'Stationery', 750, 560, 40, { schoolPrice: 700 }),
      p('Chalk White (box)', 'Stationery', 180, 120, 60, { schoolPrice: 160 }),
      p('Maize 90kg bag', 'Foodstuffs', 4200, 3700, 40, { schoolPrice: 4000 }),
      p('Beans 90kg bag', 'Foodstuffs', 9800, 8900, 20, { schoolPrice: 9500 }),
      p('Cooking Oil 20L', 'Foodstuffs', 5600, 5000, 15, { schoolPrice: 5400 }),
      p('Rice 50kg bag', 'Foodstuffs', 7500, 6700, 12, { schoolPrice: 7200 }),
      p('Bar Soap (carton)', 'Cleaning', 2600, 2200, 20, { schoolPrice: 2500 }),
      p('Science Kit (lab)', 'Lab equipment', 12500, 9800, 6, { schoolPrice: 12000 }),
    ],
    customers: ['Uriri Day Secondary School', 'Rongo Girls High School', 'Awendo Mixed Primary', 'Migori Boys High School'],
  },
];

export const RENTAL_KIT = {
  industryType: 'RENTAL',
  label: 'Property rentals',
  businessName: 'Makao Homes',
  ownerName: 'Pamela Auma',
  branchName: 'Office',
  county: 'Kisumu',
  properties: [
    { name: 'Makao Apartments', address: 'Milimani, Kisumu', units: [['A1', 15000], ['A2', 15000], ['A3', 18000], ['B1', 12000], ['B2', 12000], ['B3', 12000]] as [string, number][] },
    { name: 'Sunrise Bedsitters', address: 'Nyalenda, Kisumu', units: [['BS1', 6500], ['BS2', 6500], ['BS3', 6500], ['BS4', 7000]] as [string, number][] },
  ],
  tenants: ['Kevin Odhiambo', 'Mary Akoth', 'Felix Kiprono', 'Sharon Anyango', 'George Mutua', 'Irene Chepkoech', 'Victor Ouma'],
};

export const CONSTRUCTION_KIT = {
  industryType: 'CONSTRUCTION',
  label: 'Construction',
  businessName: 'Jenga Imara Contractors',
  ownerName: 'Patrick Otieno',
  branchName: 'Head Office',
  county: 'Migori',
  projects: [
    { code: 'PRJ-001', name: 'Rongo Market Stalls', worksClass: 'BUILDING' as const, contractSum: 4_850_000, location: 'Rongo Town', status: 'ACTIVE' as const, startIn: -45, finishIn: 75 },
    { code: 'PRJ-002', name: 'Awendo Access Road (2 km)', worksClass: 'ROADS_CIVIL' as const, contractSum: 12_400_000, location: 'Awendo', status: 'PLANNING' as const, startIn: 20, finishIn: 200 },
  ],
};

// Pharmacy is hidden until its compliance questions are settled; its kit is kept for later.
export const TRAINING_TYPES = [...TRAINING_KITS.map((k) => k.industryType).filter((t) => t !== 'PHARMACY'), RENTAL_KIT.industryType, CONSTRUCTION_KIT.industryType];

export const kitLabel = (industryType: string) =>
  TRAINING_KITS.find((k) => k.industryType === industryType)?.label ?? (industryType === 'RENTAL' ? RENTAL_KIT.label : industryType === 'CONSTRUCTION' ? CONSTRUCTION_KIT.label : industryType);
