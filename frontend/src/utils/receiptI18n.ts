export type ReceiptLang = 'en' | 'si';

export const receiptLabels: Record<ReceiptLang, {
  invoiceNo:   string;
  cashier:     string;
  customer:    string;
  date:        string;
  product:     string;
  qty:         string;
  price:       string;
  discount:    string;
  amount:      string;
  subtotal:    string;
  tax:         string;
  total:       string;
  tendered:    string;
  change:      string;
  balance:     string;
  itemCount:   string;
  creditSale:  string;
  reprint:     string;
  walkIn:      string;
  thankYou:    string;
  poweredBy:   string;
}> = {
  en: {
    invoiceNo:  'Invoice No.',
    cashier:    'Cashier',
    customer:   'Customer',
    date:       'Date',
    product:    'Product',
    qty:        'Qty',
    price:      'Price',
    discount:   'Disc.',
    amount:     'Amount',
    subtotal:   'Subtotal',
    tax:        'Tax',
    total:      'TOTAL',
    tendered:   'Tendered',
    change:     'Change',
    balance:    'Balance Due',
    itemCount:  'Items',
    creditSale: 'CREDIT SALE',
    reprint:    'REPRINT',
    walkIn:     'Walk-in',
    thankYou:   'Thank You! Come Again',
    poweredBy:  'Powered by BROcode ERP',
  },
  si: {
    invoiceNo:  'ඉන්වොයිස් අංකය',
    cashier:    'අයකැමි',
    customer:   'ගනුදෙනුකරු',
    date:       'දිනය',
    product:    'භාණ්ඩය',
    qty:        'ප්‍රමාණය',
    price:      'මිල',
    discount:   'වට්ටම',
    amount:     'එකතුව',
    subtotal:   'උප එකතුව',
    tax:        'බදු',
    total:      'මුළු එකතුව',
    tendered:   'ගෙවූ මුදල',
    change:     'ඉතිරිය',
    balance:    'ගෙවිය යුතු',
    itemCount:  'භාණ්ඩ ගණන',
    creditSale: 'ණය විකිණීම',
    reprint:    'නැවත මුද්‍රණය',
    walkIn:     'සාමාන්‍ය ගනුදෙනු',
    thankYou:   'ස්තූතියි! නැවත වඩිනු ලැබේවා',
    poweredBy:  'BROcode ERP මගින් බල ගැන්වේ',
  },
};
