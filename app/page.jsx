'use client';

import { useState } from 'react';

const faqs = [
  ['Can I connect my existing store?', 'Yes. MongersMint connects with Shopify, WooCommerce, Wix and custom storefronts. Our onboarding team will help you bring your order history along.'],
  ['How quickly can we get live?', 'Most teams are shipping their first automated orders in under a day. Larger or custom workflows are typically live within a week.'],
  ['Which carriers do you support?', 'Use your own carrier accounts or access our partner network. You can mix carriers by pin code, price, SLA, and shipment type.'],
  ['Is there a long-term contract?', 'No. Start monthly, scale when you are ready, and upgrade only when your shipment volume calls for it.'],
];

export default function Home() {
  const [notice, setNotice] = useState('');
  const [activeTestimonial, setActiveTestimonial] = useState(0);
  const testimonials = [
    ['“We went from three disconnected tools to one calm operating system. The team now spends time growing, not chasing shipments.”', 'Aarav Mehta', 'Founder, Northstar Goods'],
    ['“MongersMint made our fulfillment data actually useful. The exception alerts alone paid for it in the first month.”', 'Nisha Kapoor', 'COO, Studio Kora'],
    ['“The fastest implementation we have had for an operations tool. Our team adopted it without a manual.”', 'Rohan Shah', 'Head of Commerce, Fable & Co.'],
  ];
  const submit = (event, message) => {
    event.preventDefault();
    event.currentTarget.reset();
    setNotice(message);
  };

  return <main className="mint">
    <header className="mintNav">
      <a className="mintBrand" href="#top" aria-label="MongersMint home"><span>m</span>mongersmint</a>
      <nav className="mintLinks" aria-label="Main navigation">
        <details className="productMenu"><summary>Product <i>⌄</i></summary><div><a href="#features">Features</a><a href="#solutions">Solutions</a></div></details>
        <a href="#pricing">Pricing</a><a href="#resources">Resources</a><a href="#about">About</a><a href="#contact">Contact</a>
      </nav>
      <a className="mintButton mintNavCta" href="#demo">Book a demo <b>→</b></a>
    </header>

    <section className="mintHero" id="top">
      <div className="heroCopy">
        <div className="eyebrowMint"><span /> THE OPERATING SYSTEM FOR MODERN COMMERCE</div>
        <h1>Make every order<br /><em>move smarter.</em></h1>
        <p>One intelligent workspace for order fulfillment, delivery visibility, and exceptional customer experiences.</p>
        <div className="heroButtons"><a className="mintButton" href="#demo">Book a demo <b>→</b></a><a className="mintTextButton" href="#product">See how it works <b>↗</b></a></div>
        <div className="heroProof"><div className="avatarStack"><span>R</span><span>A</span><span>S</span><span>K</span></div><p><strong>Built for the teams behind<br />the brands you love.</strong></p></div>
      </div>
      <div className="heroVisual" aria-label="MongersMint product preview">
        <div className="orbit orbitOne" /><div className="orbit orbitTwo" />
        <div className="productWindow">
          <div className="windowTop"><div className="windowDots"><i /><i /><i /></div><div className="windowBrand">m <span>MongersMint</span></div><div className="windowUser">AK</div></div>
          <div className="windowBody"><aside><span className="sideLogo">m</span><i className="active" /><i /><i /><i /><i /><small>?</small></aside><div className="dash"><div className="dashHead"><div><p>Good morning, Amara <b>✦</b></p><small>Here’s what’s moving today.</small></div><button>+ Create shipment</button></div><div className="dashStats"><Metric label="Orders today" value="1,284" up="12.5%" /><Metric label="On-time delivery" value="96.8%" up="3.2%" /><Metric label="Exception rate" value="1.4%" up="0.8%" /></div><div className="chartCard"><div><p>Fulfillment velocity</p><small>Orders processed this week</small></div><div className="legend"><i /> This week <b>⋯</b></div><div className="chart"><span /><span /><span /><span /><span /><span /><span /></div><div className="chartLabels"><small>Mon</small><small>Tue</small><small>Wed</small><small>Thu</small><small>Fri</small><small>Sat</small><small>Sun</small></div></div><div className="miniCards"><div><span className="truck">⌁</span><p>Carrier performance</p><strong>98.2%</strong><small>On time this month</small></div><div><span className="spark">✦</span><p>Automation savings</p><strong>42 hrs</strong><small>Saved this week</small></div></div></div></div>
        </div>
        <div className="floatingCard cardOne"><span>⌁</span><div><small>Shipment #MM-4829</small><strong>Out for delivery</strong></div><b>✓</b></div><div className="floatingCard cardTwo"><span>✦</span><div><small>Automation</small><strong>18 tasks completed</strong></div></div>
      </div>
    </section>

    <section className="logoStrip"><p>TRUSTED BY AMBITIOUS COMMERCE TEAMS</p><div><b>VANTA</b><b>northstar</b><b>RAYO</b><b>MADEWELL</b><b>fleur.</b></div></section>
    <section className="commerceCollage"><img src="/images/mongersmint-commerce-collage.png" alt="Commerce teams and fulfillment in motion" /><div className="collageCopy"><div className="eyebrowMint"><span /> KEEPING COMMERCE IN MOTION</div><h2>Built around the<br /><em>real work.</em></h2><p>From a customer’s first click to a package at their door, bring the people, moments, and data together.</p><div className="collageStats"><span><b>42 hrs</b> saved weekly</span><span><b>96.8%</b> on-time delivery</span></div></div></section>
    <section className="section mintFeatures" id="features"><div className="sectionIntro"><div className="eyebrowMint"><span /> ONE PLATFORM, EVERY MOVE</div><h2>Less busywork.<br /><em>More momentum.</em></h2><p>Turn scattered shipping operations into your competitive advantage with tools that make every handoff seamless.</p></div><div className="featureGrid"><Feature num="01" title="A single source of truth" copy="Every order, carrier, and customer conversation in one beautifully clear workspace." icon="◌" /><Feature num="02" title="Automation that feels human" copy="Let intelligent workflows handle the repetitive work while your team focuses on the moments that matter." icon="✦" /><Feature num="03" title="Visibility without the chasing" copy="Live delivery intelligence that helps you spot exceptions before your customers do." icon="⌁" /></div></section>
    <section className="solutionsBand" id="solutions"><div><div className="eyebrowMint"><span /> BUILT TO SCALE WITH YOU</div><h2>Your next level,<br /><em>already mapped.</em></h2><a className="mintButton light" href="#demo">Explore solutions <b>→</b></a></div><div className="solutionList"><p><b>01</b> D2C brands <span>→</span></p><p><b>02</b> Marketplace sellers <span>→</span></p><p><b>03</b> Multi-location teams <span>→</span></p></div></section>
    <section className="section pricing" id="pricing"><div className="centerIntro"><div className="eyebrowMint"><span /> SIMPLE, TRANSPARENT PRICING</div><h2>Start lean. <em>Scale freely.</em></h2><p>Everything you need to make fulfillment a growth engine.</p></div><div className="pricingGrid"><Price name="Starter" price="₹4,999" desc="For teams getting their operations in sync." features={['Up to 1,000 shipments / month','2 team members','Core automations','Standard support']} /><Price featured name="Growth" price="₹12,999" desc="For brands ready to move with more confidence." features={['Up to 5,000 shipments / month','10 team members','Advanced automations','Priority support','Custom reports']} /><Price name="Scale" price="Custom" desc="For high-volume teams with complex needs." features={['Unlimited shipments','Unlimited team members','Custom workflows','Dedicated success manager']} /></div><div className="comparison"><h3>Compare plans</h3><div className="compareHead"><span>Everything you need to ship smarter</span><b>Starter</b><b>Growth</b><b>Scale</b></div>{[['Shipment visibility','✓','✓','✓'],['Automated workflows','—','✓','✓'],['Custom integrations','—','—','✓'],['Dedicated success manager','—','—','✓']].map(row=><div className="compareRow" key={row[0]}><span>{row[0]}</span><b>{row[1]}</b><b>{row[2]}</b><b>{row[3]}</b></div>)}</div></section>
    <section className="testimonialSection" id="resources"><div className="eyebrowMint"><span /> WHAT CUSTOMERS SAY</div><div className="quoteMark">“</div><blockquote>{testimonials[activeTestimonial][0]}</blockquote><div className="testimonialPerson"><div>{testimonials[activeTestimonial][1].split(' ').map(x=>x[0]).join('')}</div><p><strong>{testimonials[activeTestimonial][1]}</strong><br />{testimonials[activeTestimonial][2]}</p></div><div className="sliderControls"><button aria-label="Previous testimonial" onClick={()=>setActiveTestimonial((activeTestimonial+2)%3)}>←</button><div>{[0,1,2].map(i=><i className={i===activeTestimonial?'selected':''} key={i} />)}</div><button aria-label="Next testimonial" onClick={()=>setActiveTestimonial((activeTestimonial+1)%3)}>→</button></div></section>
    <section className="section faqSection" id="about"><div className="faqIntro"><div className="eyebrowMint"><span /> FAQS</div><h2>Questions, <em>answered.</em></h2><p>Can’t find what you need? <a href="#contact">Talk to our team →</a></p></div><div className="faqList">{faqs.map(([question, answer], index)=><details key={question} open={index===0}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div></section>
    <section className="demoSection" id="demo"><div><div className="eyebrowMint"><span /> READY WHEN YOU ARE</div><h2>See what your<br /><em>operations can become.</em></h2><p>Book a tailored walkthrough and see MongersMint in motion with your workflow.</p></div><form onSubmit={e=>submit(e, 'Thanks — we’ll be in touch to arrange your demo.')}><label>Work email<input required type="email" placeholder="you@company.com" /></label><label>Company name<input required placeholder="Your company" /></label><button className="mintButton" type="submit">Book my demo <b>→</b></button>{notice && <p className="formNotice">{notice}</p>}</form></section>
    <footer id="contact"><a className="mintBrand" href="#top"><span>m</span>mongersmint</a><p>© 2026 MongersMint. The commerce operations platform.</p><div><a href="#pricing">Pricing</a><a href="#resources">Resources</a><a href="mailto:hello@mongersmint.com">hello@mongersmint.com</a></div></footer>
  </main>;
}

function Metric({label,value,up}) { return <div><small>{label}</small><strong>{value}</strong><em>↑ {up}</em></div>; }
function Feature({num,title,copy,icon}) { return <article><div className="featureIcon">{icon}</div><small>{num}</small><h3>{title}</h3><p>{copy}</p><a href="#demo">Learn more →</a></article>; }
function Price({name,price,desc,features,featured}) { return <article className={featured?'featured':''}>{featured&&<span className="popular">MOST POPULAR</span>}<h3>{name}</h3><p>{desc}</p><strong>{price}<small>{price !== 'Custom' && ' / month'}</small></strong><a href="#demo" className={featured?'mintButton':'priceButton'}>{price==='Custom'?'Talk to sales':'Start free trial'} <b>→</b></a><ul>{features.map(x=><li key={x}>✓ <span>{x}</span></li>)}</ul></article>; }
