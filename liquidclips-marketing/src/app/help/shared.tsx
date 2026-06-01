import Link from "next/link";
import { PageShell } from "@/components/Chrome";
import { supportEmail } from "@/lib/site";

type HelpSection = {
  heading: string;
  body: string[];
};

export function HelpArticle({
  title,
  lede,
  sections,
}: {
  title: string;
  lede: string;
  sections: HelpSection[];
}) {
  return (
    <PageShell>
      <main className="help-page">
        <section className="help-hero">
          <div className="container">
            <Link className="help-back" href="/help">
              Help center
            </Link>
            <h1 className="page-title">{title}</h1>
            <p className="page-lede">{lede}</p>
          </div>
        </section>

        <article className="section">
          <div className="container help-article">
            {sections.map((section) => (
              <section className="help-section" key={section.heading}>
                <h2>{section.heading}</h2>
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </section>
            ))}

            <div className="help-callout">
              <h2>Still stuck?</h2>
              <p>
                Send the source link, your macOS version, and what the app showed to{" "}
                <a href={`mailto:${supportEmail}`}>{supportEmail}</a>.
              </p>
            </div>
          </div>
        </article>
      </main>
    </PageShell>
  );
}
