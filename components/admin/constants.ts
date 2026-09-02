// ═══════════════════════════════════════════════════════════════
// Admin Constants - Shared constants for Admin components
// ═══════════════════════════════════════════════════════════════

import { ThemeConfig } from './AdminTypes';

// Hidden admin usernames
export const HIDDEN_ADMIN_USERNAMES = new Set(['adminhim', 'admin']);

// Privacy storage keys
export const PRIVACY_ADD_KEY = 'hader_privacy_add_student_ack';
export const PRIVACY_IMPORT_KEY = 'hader_privacy_import_students_ack';

// Theme configurations - Professional Gradient Themes
export const THEME_CONFIG: Record<string, ThemeConfig> = {
  default: {
    name: 'نيون سايبر',
    nameEn: 'Cyber Neon',
    emoji: '⚡',
    gradient: 'from-primary-500 via-secondary-500 to-secondary-600',
    colors: ['bg-primary-500', 'bg-secondary-600'],
    primary_400: '34 211 238',
    primary_500: '6 182 212',
    primary_600: '8 145 178',
    secondary_400: '96 165 250',
    secondary_500: '37 99 235',
    secondary_600: '29 78 216'
  },
  ocean: {
    name: 'أزرق محيطي',
    nameEn: 'Ocean Blue',
    emoji: '🌊',
    gradient: 'from-sky-500 via-secondary-500 to-secondary-600',
    colors: ['bg-sky-500', 'bg-secondary-600'],
    primary_400: '56 189 248',
    primary_500: '14 165 233',
    primary_600: '2 132 199',
    secondary_400: '96 165 250',
    secondary_500: '59 130 246',
    secondary_600: '37 99 235'
  },
  nature: {
    name: 'أخضر طبيعي',
    nameEn: 'Forest Green',
    emoji: '🌿',
    gradient: 'from-emerald-500 via-green-500 to-lime-500',
    colors: ['bg-emerald-500', 'bg-lime-500'],
    primary_400: '52 211 153',
    primary_500: '16 185 129',
    primary_600: '5 150 105',
    secondary_400: '134 239 172',
    secondary_500: '34 197 94',
    secondary_600: '22 163 74'
  },
  sunset: {
    name: 'غروب دافئ',
    nameEn: 'Sunset Warm',
    emoji: '🌅',
    gradient: 'from-orange-500 via-secondary-500 to-rose-500',
    colors: ['bg-orange-500', 'bg-rose-500'],
    primary_400: '251 146 60',
    primary_500: '249 115 22',
    primary_600: '234 88 12',
    secondary_400: '251 113 133',
    secondary_500: '236 72 153',
    secondary_600: '219 39 119'
  },
  violet: {
    name: 'بنفسجي ملكي',
    nameEn: 'Royal Violet',
    emoji: '✨',
    gradient: 'from-secondary-500 via-secondary-500 to-fuchsia-500',
    colors: ['bg-secondary-500', 'bg-fuchsia-500'],
    primary_400: '167 139 250',
    primary_500: '139 92 246',
    primary_600: '124 58 237',
    secondary_400: '192 132 252',
    secondary_500: '168 85 247',
    secondary_600: '147 51 234'
  },
  midnight: {
    name: 'ليلي أنيق',
    nameEn: 'Midnight',
    emoji: '🌙',
    gradient: 'from-indigo-600 via-secondary-600 to-indigo-700',
    colors: ['bg-indigo-600', 'bg-indigo-700'],
    primary_400: '129 140 248',
    primary_500: '99 102 241',
    primary_600: '79 70 229',
    secondary_400: '96 165 250',
    secondary_500: '59 130 246',
    secondary_600: '37 99 235'
  },
  aurora: {
    name: 'شفق قطبي',
    nameEn: 'Aurora',
    emoji: '🌌',
    gradient: 'from-teal-500 via-primary-500 to-sky-500',
    colors: ['bg-teal-500', 'bg-sky-500'],
    primary_400: '45 212 191',
    primary_500: '20 184 166',
    primary_600: '13 148 136',
    secondary_400: '34 211 238',
    secondary_500: '6 182 212',
    secondary_600: '8 145 178'
  },
  ruby: {
    name: 'ياقوت أحمر',
    nameEn: 'Ruby Red',
    emoji: '💎',
    gradient: 'from-rose-500 via-red-500 to-secondary-500',
    colors: ['bg-rose-500', 'bg-secondary-500'],
    primary_400: '251 113 133',
    primary_500: '244 63 94',
    primary_600: '225 29 72',
    secondary_400: '248 113 113',
    secondary_500: '239 68 68',
    secondary_600: '220 38 38'
  },
  olive: {
    name: 'أخضر زيتوني طبيعي',
    nameEn: 'Olive Green',
    emoji: '🌿',
    gradient: 'from-[#4B593F] via-[#5a6d4d] to-[#6b815b]',
    colors: ['bg-[#4B593F]', 'bg-[#5a6d4d]'],
    primary_400: '96 114 81',
    primary_500: '75 89 63',
    primary_600: '54 64 46',
    secondary_400: '107 129 91',
    secondary_500: '90 108 77',
    secondary_600: '75 89 63'
  },
  lavender: {
    name: 'بنفسجي ضبابي',
    nameEn: 'Misty Lavender',
    emoji: '💜',
    gradient: 'from-[#9A89AA] via-[#a89bb8] to-[#b6adc6]',
    colors: ['bg-[#9A89AA]', 'bg-[#a89bb8]'],
    primary_400: '181 173 198',
    primary_500: '154 137 170',
    primary_600: '127 111 142',
    secondary_400: '190 183 206',
    secondary_500: '168 155 184',
    secondary_600: '154 137 170'
  },
  chocolate: {
    name: 'بني دافئ',
    nameEn: 'Warm Brown',
    emoji: '🤎',
    gradient: 'from-[#5B3E27] via-[#6d4c31] to-[#7f5a3b]',
    colors: ['bg-[#5B3E27]', 'bg-[#6d4c31]'],
    primary_400: '127 90 59',
    primary_500: '91 62 39',
    primary_600: '64 44 28',
    secondary_400: '143 102 67',
    secondary_500: '109 76 49',
    secondary_600: '91 62 39'
  },
  darkchoco: {
    name: 'شوكولاته غامق',
    nameEn: 'Dark Chocolate',
    emoji: '🍫',
    gradient: 'from-[#431C0D] via-[#552416] to-[#672c1f]',
    colors: ['bg-[#431C0D]', 'bg-[#552416]'],
    primary_400: '103 44 31',
    primary_500: '67 28 13',
    primary_600: '45 19 9',
    secondary_400: '119 56 39',
    secondary_500: '85 36 22',
    secondary_600: '67 28 13'
  },
  terracotta: {
    name: 'طيني ترابي',
    nameEn: 'Terracotta',
    emoji: '🧱',
    gradient: 'from-[#975039] via-[#a96247] to-[#bb7455]',
    colors: ['bg-[#975039]', 'bg-[#a96247]'],
    primary_400: '187 116 85',
    primary_500: '151 80 57',
    primary_600: '115 61 43',
    secondary_400: '203 132 101',
    secondary_500: '169 98 71',
    secondary_600: '151 80 57'
  },
  cherry: {
    name: 'زهر الكرز',
    nameEn: 'Cherry Blossom',
    emoji: '🌸',
    gradient: 'from-secondary-400 via-rose-400 to-secondary-400',
    colors: ['bg-secondary-400', 'bg-secondary-400'],
    primary_400: '244 114 182',
    primary_500: '236 72 153',
    primary_600: '219 39 119',
    secondary_400: '251 113 133',
    secondary_500: '244 63 94',
    secondary_600: '225 29 72'
  },
  fire: {
    name: 'جمر ناري',
    nameEn: 'Fire Ember',
    emoji: '🔥',
    gradient: 'from-red-500 via-orange-500 to-amber-500',
    colors: ['bg-red-500', 'bg-amber-500'],
    primary_400: '248 113 113',
    primary_500: '239 68 68',
    primary_600: '220 38 38',
    secondary_400: '251 146 60',
    secondary_500: '249 115 22',
    secondary_600: '234 88 12'
  },
  electric: {
    name: 'عاصفة كهربائية',
    nameEn: 'Electric Storm',
    emoji: '⚡',
    gradient: 'from-yellow-400 via-secondary-500 to-indigo-600',
    colors: ['bg-yellow-400', 'bg-indigo-600'],
    primary_400: '250 204 21',
    primary_500: '234 179 8',
    primary_600: '202 138 4',
    secondary_400: '167 139 250',
    secondary_500: '139 92 246',
    secondary_600: '124 58 237'
  },
  deepocean: {
    name: 'محيط عميق',
    nameEn: 'Deep Ocean',
    emoji: '🌊',
    gradient: 'from-secondary-900 via-indigo-900 to-teal-800',
    colors: ['bg-secondary-900', 'bg-teal-800'],
    primary_400: '96 165 250',
    primary_500: '59 130 246',
    primary_600: '37 99 235',
    secondary_400: '45 212 191',
    secondary_500: '20 184 166',
    secondary_600: '13 148 136'
  },
  mint: {
    name: 'نعناع منعش',
    nameEn: 'Mint Fresh',
    emoji: '🍃',
    gradient: 'from-emerald-400 via-teal-400 to-primary-400',
    colors: ['bg-emerald-400', 'bg-primary-400'],
    primary_400: '52 211 153',
    primary_500: '16 185 129',
    primary_600: '5 150 105',
    secondary_400: '45 212 191',
    secondary_500: '20 184 166',
    secondary_600: '13 148 136'
  },
  galaxy: {
    name: 'مجرة بنفسجية',
    nameEn: 'Galaxy Purple',
    emoji: '🌌',
    gradient: 'from-secondary-600 via-secondary-600 to-fuchsia-600',
    colors: ['bg-secondary-600', 'bg-fuchsia-600'],
    primary_400: '192 132 252',
    primary_500: '168 85 247',
    primary_600: '147 51 234',
    secondary_400: '232 121 249',
    secondary_500: '217 70 239',
    secondary_600: '192 38 211'
  },
  desert: {
    name: 'رمال صحراوية',
    nameEn: 'Desert Sand',
    emoji: '🏜️',
    gradient: 'from-amber-600 via-orange-600 to-yellow-600',
    colors: ['bg-amber-600', 'bg-yellow-600'],
    primary_400: '251 191 36',
    primary_500: '245 158 11',
    primary_600: '217 119 6',
    secondary_400: '251 146 60',
    secondary_500: '249 115 22',
    secondary_600: '234 88 12'
  }
};

// Tab definitions for admin navigation (مرتبة منطقياً)
export const ADMIN_TABS = [
  // === القسم الرئيسي ===
  { id: 'dashboard', label: 'لوحة التحكم', icon: 'LayoutDashboard' },
  
  // === إدارة البيانات ===
  { id: 'students', label: 'الطلاب', icon: 'Users' },
  { id: 'structure', label: 'الهيكل المدرسي', icon: 'Database' },
  { id: 'reports', label: 'التقارير', icon: 'FileText' },
  
  // === إدارة المستخدمين ===
  { id: 'users', label: 'المستخدمون', icon: 'UserIcon' },
  
  // === التواصل والمتابعة ===
  { id: 'follow-up', label: 'المتابعة', icon: 'Bell' },
  { id: 'notifications', label: 'الإشعارات', icon: 'MessageSquare' },
  
  // === الإعدادات والصيانة ===
  { id: 'kiosk', label: 'إعدادات الكشك', icon: 'Monitor' },
  { id: 'settings', label: 'الإعدادات العامة', icon: 'SettingsIcon' },
  { id: 'backup', label: 'النسخ الاحتياطي', icon: 'Database' }
] as const;

export type AdminTabId = typeof ADMIN_TABS[number]['id'];
