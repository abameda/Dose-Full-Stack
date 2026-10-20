export interface Governorate {
  /** Latin kebab-case, the value stored in `orders.governorate` and `governorate_delivery`. */
  code: string;
  nameAr: string;
  nameEn: string;
}

/** Egypt's 27 governorates. The migration seeds `governorate_delivery` with the same codes. */
export const GOVERNORATES: readonly Governorate[] = [
  { code: 'cairo', nameAr: 'القاهرة', nameEn: 'Cairo' },
  { code: 'giza', nameAr: 'الجيزة', nameEn: 'Giza' },
  { code: 'alexandria', nameAr: 'الإسكندرية', nameEn: 'Alexandria' },
  { code: 'qalyubia', nameAr: 'القليوبية', nameEn: 'Qalyubia' },
  { code: 'port-said', nameAr: 'بورسعيد', nameEn: 'Port Said' },
  { code: 'suez', nameAr: 'السويس', nameEn: 'Suez' },
  { code: 'damietta', nameAr: 'دمياط', nameEn: 'Damietta' },
  { code: 'dakahlia', nameAr: 'الدقهلية', nameEn: 'Dakahlia' },
  { code: 'sharqia', nameAr: 'الشرقية', nameEn: 'Sharqia' },
  { code: 'gharbia', nameAr: 'الغربية', nameEn: 'Gharbia' },
  { code: 'monufia', nameAr: 'المنوفية', nameEn: 'Monufia' },
  { code: 'beheira', nameAr: 'البحيرة', nameEn: 'Beheira' },
  { code: 'kafr-el-sheikh', nameAr: 'كفر الشيخ', nameEn: 'Kafr El Sheikh' },
  { code: 'ismailia', nameAr: 'الإسماعيلية', nameEn: 'Ismailia' },
  { code: 'faiyum', nameAr: 'الفيوم', nameEn: 'Faiyum' },
  { code: 'beni-suef', nameAr: 'بني سويف', nameEn: 'Beni Suef' },
  { code: 'minya', nameAr: 'المنيا', nameEn: 'Minya' },
  { code: 'asyut', nameAr: 'أسيوط', nameEn: 'Asyut' },
  { code: 'sohag', nameAr: 'سوهاج', nameEn: 'Sohag' },
  { code: 'qena', nameAr: 'قنا', nameEn: 'Qena' },
  { code: 'luxor', nameAr: 'الأقصر', nameEn: 'Luxor' },
  { code: 'aswan', nameAr: 'أسوان', nameEn: 'Aswan' },
  { code: 'red-sea', nameAr: 'البحر الأحمر', nameEn: 'Red Sea' },
  { code: 'new-valley', nameAr: 'الوادي الجديد', nameEn: 'New Valley' },
  { code: 'matrouh', nameAr: 'مطروح', nameEn: 'Matrouh' },
  { code: 'north-sinai', nameAr: 'شمال سيناء', nameEn: 'North Sinai' },
  { code: 'south-sinai', nameAr: 'جنوب سيناء', nameEn: 'South Sinai' },
];
