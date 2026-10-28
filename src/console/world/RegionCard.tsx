import React from 'react';

interface Props {
  index: number;
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
}

// The second row of the console is four numbered regions: three working views
// and the creatives strip. Each keeps the number and one-line explanation so
// the page reads the same way as the reference layout.
export default function RegionCard(props: Props): React.JSX.Element {
  return (
    <section className={props.className ? `region ${props.className}` : 'region'} aria-label={props.title}>
      <div className="region-head">
        <span className="region-num" aria-hidden="true">
          {props.index}.
        </span>
        <h3>{props.title}</h3>
      </div>
      <p className="region-desc">{props.description}</p>
      <div className="region-body">{props.children}</div>
    </section>
  );
}
