// נקודת עריכה אחת לפרטי הקשר ולכתובות. בהמשך יוזרם מהגדרות הארגון.
// שם המותג אחיד בכל האתר: URSA GROUP (כפי שמופיע בלוגו). הדומיין
// ort-tech.co.il נשאר כתשתית (דוא״ל ואתר) ואינו שם מותג נפרד.
export const SITE = {
  name: 'URSA GROUP · גיוס והשמה',
  shortName: 'URSA GROUP',
  tagline: 'מוצאים לך את האנשים הנכונים',
  /** [להשלמה: מספר טלפון אמיתי של המשרד] */
  phone: '03-0000000',
  phoneHref: 'tel:+97230000000',
  whatsapp: 'https://wa.me/972500000000',
  email: 'jobs@ort-tech.co.il',
  employersEmail: 'info@ort-tech.co.il',
  /** פניות בנושא פרטיות והצהרת נגישות */
  privacyEmail: 'privacy@ort-tech.co.il',
  accessibilityEmail: 'accessibility@ort-tech.co.il',
  candidateArea: 'https://my.hr.ort-tech.co.il',
  /** פרופילים ציבוריים ל-sameAs ב-JSON-LD. ריק = לא נכלל. */
  sameAs: [] as string[],
};

export const NAV = [
  { href: '/',         label: 'בית' },
  { href: '/jobs/',    label: 'משרות' },
  { href: '/about/',   label: 'אודות' },
  { href: '/contact/', label: 'יצירת קשר' },
];
