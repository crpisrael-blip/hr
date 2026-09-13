/**
 * הצגת טלפון/דוא״ל בתוך טקסט עברי. דפוס bidi אחד לכל המערכת — היו שלושה
 * דפוסים שונים (bdi ריק, bdi dir="ltr", dd עם dir+textAlign) שנתנו תוצאות שונות.
 */
export default function Contact({ kind, value, linked = true }:
  { kind: 'phone' | 'email'; value: string | null | undefined; linked?: boolean }) {
  const v = value?.trim();
  if (!v) return <>—</>;
  const content = <bdi dir="ltr">{v}</bdi>;
  if (!linked) return content;
  const href = kind === 'email' ? `mailto:${v}` : `tel:${v.replace(/[^\d+]/g, '')}`;
  return <a href={href} className="contact-link">{content}</a>;
}
