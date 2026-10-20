import type { Lang } from '@dose/contract';

// Every customer-facing string of the storefront, in both languages, and nowhere else: pages,
// directions and islands read them from here, so changing a word is one edit and the native
// review of the Arabic (the strings below are a first draft in everyday Egyptian Arabic) touches
// one file. `ar` and `en` have the same keys (a unit test checks it, and the type below does
// too). `{name}` marks a value filled in at run time with `fill`. Prices come from `formatEgp`
// and are never part of a string.

export const en = {
  // ── The page frame ────────────────────────────────────────────────────────────────────────
  brand: 'DÖSE',
  skipToContent: 'Skip to content',
  homeLink: 'DÖSE, home',
  switchLanguage: 'Switch language',
  otherLanguageName: 'العربية',
  footerNote: 'Cash on delivery across Egypt.',

  // ── Home ──────────────────────────────────────────────────────────────────────────────────
  homeTitle: 'DÖSE | Eau de parfum, cash on delivery',
  homeDescription: 'Eau de parfum by DÖSE, delivered across Egypt. You pay in cash when it arrives.',
  homeHeading: 'Fragrance by DÖSE',
  homeIntro: 'Eau de parfum, delivered across Egypt. You pay in cash when it arrives.',
  collectionHeading: 'The collection',
  priceFrom: 'From {price}',
  soldOut: 'Sold out',

  // ── Product ───────────────────────────────────────────────────────────────────────────────
  productTitle: '{name} | DÖSE',
  storyHeading: 'The story',
  detailsHeading: 'Details',
  sizeLabel: 'Size',
  sizeMl: '{ml} ml',
  kindFull: 'Full size',
  kindSample: 'Sample',
  kindTester: 'Tester',
  addToBag: 'Add to bag',
  addedToBag: 'Added to your bag.',
  productDelivery: 'Delivery across Egypt. Pay in cash when it arrives.',
  backToCollection: 'Back to the collection',

  // ── The bag ───────────────────────────────────────────────────────────────────────────────
  bagButton: 'Bag ({count})',
  bagTitle: 'Your bag',
  closeBag: 'Close',
  bagEmpty: 'Your bag is empty.',
  continueShopping: 'Continue shopping',
  bagLoading: 'Loading your bag…',
  bagError: 'We could not load your bag. Check your connection.',
  retry: 'Try again',
  lineUnavailable: 'No longer available',
  decreaseQuantity: 'One less {name}',
  increaseQuantity: 'One more {name}',
  quantityOf: 'Quantity: {quantity}',
  removeLine: 'Remove {name}',
  subtotal: 'Subtotal',
  deliveryAtCheckout: 'Delivery is added at checkout.',
  checkout: 'Checkout',

  // ── Checkout ──────────────────────────────────────────────────────────────────────────────
  checkoutTitle: 'Checkout | DÖSE',
  checkoutHeading: 'Checkout',
  checkoutLoading: 'Loading your order…',
  checkoutEmpty: 'Your bag is empty, so there is nothing to order yet.',
  contactHeading: 'Your details',
  addressHeading: 'Delivery address',
  fieldName: 'Full name',
  fieldPhone: 'Mobile number',
  hintPhone: 'We call or WhatsApp you to confirm the order. For example 010 1234 5678.',
  fieldGovernorate: 'Governorate',
  chooseGovernorate: 'Choose your governorate',
  fieldArea: 'Area',
  fieldStreet: 'Street',
  fieldBuilding: 'Building and apartment',
  fieldLandmark: 'Landmark (optional)',
  hintLandmark: 'Something nearby that helps the courier find you.',
  codHeading: 'Pay when it arrives',
  codNote:
    'You pay the courier in cash when your order arrives. Nothing is charged now. We confirm your order by phone or WhatsApp before we send it.',
  summaryHeading: 'Order summary',
  deliveryFee: 'Delivery',
  total: 'Total',
  placeOrder: 'Place order',
  placingOrder: 'Placing your order…',
  confirmNewTotal: 'Confirm new total',
  priceChanged: 'Prices changed since you added these items. Your new total is {total}. Check it, then confirm.',
  outOfStockBanner: 'Some items are not available in the quantity you chose. Remove them to continue.',
  outOfStockLine: 'Not enough in stock',
  errorSummary: 'Please check the fields that are marked.',
  errorRequired: 'This field is required.',
  errorPhone: 'Enter an Egyptian mobile number, for example 010 1234 5678.',
  errorChooseGovernorate: 'Choose your governorate.',
  errorGovernorateUnavailable: 'We cannot take cash-on-delivery orders for this governorate.',
  errorInvalidField: 'Please check this field.',
  errorNetwork: 'We could not reach the shop. Check your connection and try again.',
  errorUnexpected: 'Something went wrong on our side and your order was not placed. Please try again.',
  checkoutDisabled: 'Ordering is not available on this page.',
  studioCheckoutDisabled: 'Checkout is disabled in the studio',

  // ── Confirmation ──────────────────────────────────────────────────────────────────────────
  thanksTitle: 'Thank you | DÖSE',
  thanksHeading: 'Your order is in.',
  thanksOrderNumber: 'Order number',
  thanksNext:
    'We will call or message you on WhatsApp to confirm your order before we send it, so please keep your phone close. You pay in cash when it arrives.',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = { readonly [K in MessageKey]: string };

export const ar: Messages = {
  brand: 'DÖSE',
  skipToContent: 'تخطّي إلى المحتوى',
  homeLink: 'DÖSE، الصفحة الرئيسية',
  switchLanguage: 'تغيير اللغة',
  otherLanguageName: 'English',
  footerNote: 'الدفع كاش عند الاستلام في كل مصر.',

  homeTitle: 'DÖSE | ماء عطر والدفع عند الاستلام',
  homeDescription: 'ماء عطر من DÖSE بيوصلك في كل مصر، وبتدفع كاش لما تستلم.',
  homeHeading: 'عطور DÖSE',
  homeIntro: 'ماء عطر بيوصلك في كل مصر، وبتدفع كاش لما تستلم.',
  collectionHeading: 'المجموعة',
  priceFrom: 'ابتداءً من {price}',
  soldOut: 'الكمية خلصت',

  productTitle: '{name} | DÖSE',
  storyHeading: 'الحكاية',
  detailsHeading: 'التفاصيل',
  sizeLabel: 'الحجم',
  sizeMl: '{ml} مل',
  kindFull: 'الحجم الكامل',
  kindSample: 'عيّنة',
  kindTester: 'تستر',
  addToBag: 'أضف إلى الحقيبة',
  addedToBag: 'اتضاف للحقيبة.',
  productDelivery: 'التوصيل لكل مصر، وبتدفع كاش لما تستلم.',
  backToCollection: 'الرجوع للمجموعة',

  bagButton: 'الحقيبة ({count})',
  bagTitle: 'حقيبتك',
  closeBag: 'إغلاق',
  bagEmpty: 'حقيبتك فاضية.',
  continueShopping: 'كمّل تسوّق',
  bagLoading: 'بنحمّل حقيبتك…',
  bagError: 'معرفناش نحمّل حقيبتك. اتأكد من الاتصال بالإنترنت.',
  retry: 'جرّب تاني',
  lineUnavailable: 'مش متاح دلوقتي',
  decreaseQuantity: 'قلّل واحدة من {name}',
  increaseQuantity: 'زوّد واحدة من {name}',
  quantityOf: 'الكمية: {quantity}',
  removeLine: 'احذف {name}',
  subtotal: 'المجموع الفرعي',
  deliveryAtCheckout: 'مصاريف الشحن بتتضاف في صفحة إتمام الطلب.',
  checkout: 'إتمام الطلب',

  checkoutTitle: 'إتمام الطلب | DÖSE',
  checkoutHeading: 'إتمام الطلب',
  checkoutLoading: 'بنحمّل طلبك…',
  checkoutEmpty: 'حقيبتك فاضية، مفيش حاجة تطلبها لسه.',
  contactHeading: 'بياناتك',
  addressHeading: 'عنوان التوصيل',
  fieldName: 'الاسم بالكامل',
  fieldPhone: 'رقم الموبايل',
  hintPhone: 'هنكلمك أو نبعتلك واتساب عشان نأكد الطلب. مثال: 010 1234 5678.',
  fieldGovernorate: 'المحافظة',
  chooseGovernorate: 'اختار المحافظة',
  fieldArea: 'المنطقة',
  fieldStreet: 'الشارع',
  fieldBuilding: 'رقم العمارة والشقة',
  fieldLandmark: 'علامة مميزة (اختياري)',
  hintLandmark: 'حاجة قريبة من العنوان تساعد المندوب يوصلك.',
  codHeading: 'الدفع عند الاستلام',
  codNote:
    'هتدفع كاش للمندوب لما طلبك يوصلك، ومفيش أي مبلغ بيتخصم دلوقتي. هنكلمك أو نبعتلك واتساب عشان نأكد الطلب قبل ما نشحنه.',
  summaryHeading: 'ملخص الطلب',
  deliveryFee: 'الشحن',
  total: 'الإجمالي',
  placeOrder: 'تأكيد الطلب',
  placingOrder: 'بنسجّل طلبك…',
  confirmNewTotal: 'أكّد الإجمالي الجديد',
  priceChanged: 'الأسعار اتغيّرت من وقت ما ضفت المنتجات. إجماليك الجديد {total}. راجعه وبعدين أكّد.',
  outOfStockBanner: 'في منتجات الكمية المتاحة منها أقل من اللي اخترته. احذفها عشان تكمّل.',
  outOfStockLine: 'الكمية المتاحة مش كفاية',
  errorSummary: 'من فضلك راجع الحقول المعلّمة.',
  errorRequired: 'الحقل ده مطلوب.',
  errorPhone: 'اكتب رقم موبايل مصري صحيح، مثلاً 010 1234 5678.',
  errorChooseGovernorate: 'اختار المحافظة.',
  errorGovernorateUnavailable: 'مش بنقبل طلبات الدفع عند الاستلام للمحافظة دي.',
  errorInvalidField: 'راجع الحقل ده من فضلك.',
  errorNetwork: 'معرفناش نوصل للمتجر. اتأكد من الإنترنت وجرّب تاني.',
  errorUnexpected: 'حصلت مشكلة عندنا ومتسجّلش طلبك. جرّب تاني.',
  checkoutDisabled: 'تسجيل الطلبات مش متاح في الصفحة دي.',
  studioCheckoutDisabled: 'الدفع غير متاح في الاستوديو',

  thanksTitle: 'شكراً | DÖSE',
  thanksHeading: 'طلبك وصلنا.',
  thanksOrderNumber: 'رقم الطلب',
  thanksNext:
    'هنكلمك أو نبعتلك على واتساب عشان نأكد الطلب قبل ما نشحنه، فخلّي موبايلك قريب منك. والدفع كاش لما الطلب يوصلك.',
};

export const messages: Readonly<Record<Lang, Messages>> = { ar, en };

/** The strings of one language. */
export function t(lang: Lang): Messages {
  return messages[lang];
}

/** Puts `values` into the `{name}` marks of a string; a mark with no value stays as written. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (mark, name: string) => {
    const value = values[name];
    return value === undefined ? mark : String(value);
  });
}
