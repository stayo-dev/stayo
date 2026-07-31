import { useEffect } from 'react';
import { Check, ShieldCheck, Mail, Phone, ArrowRight } from 'lucide-react';

export function PricingPage() {
  useEffect(() => {
    document.title = "Room Plans & Pricing | Stayo";
    
    // Manage meta tags for SEO
    let metaDescription = document.querySelector('meta[name="description"]');
    if (!metaDescription) {
      metaDescription = document.createElement('meta');
      metaDescription.setAttribute('name', 'description');
      document.head.appendChild(metaDescription);
    }
    metaDescription.setAttribute('content', 'Affordable and transparent hostel accommodation pricing. Check our 2 sharing, 3 sharing, and 4 sharing room plans.');

    let ogTitle = document.querySelector('meta[property="og:title"]');
    if (!ogTitle) {
      ogTitle = document.createElement('meta');
      ogTitle.setAttribute('property', 'og:title');
      document.head.appendChild(ogTitle);
    }
    ogTitle.setAttribute('content', 'Room Plans & Pricing | Stayo');
  }, []);

  const plans = [
    {
      title: '4 Sharing Room',
      desc: 'Budget-friendly comfort for students and professionals.',
      price: '6,500',
      deposit: '3,000',
      popular: false,
      features: [
        'Budget friendly',
        'WiFi included',
        'Common washroom',
        'RO drinking water',
      ],
    },
    {
      title: '3 Sharing Room',
      desc: 'The perfect balance of privacy and affordability.',
      price: '8,500',
      deposit: '4,000',
      popular: true,
      features: [
        'WiFi included',
        'Housekeeping',
        'Power backup',
        'Laundry area access',
      ],
    },
    {
      title: '2 Sharing Room',
      desc: 'Premium privacy and additional space for your peace of mind.',
      price: '12,000',
      deposit: '5,000',
      popular: false,
      features: [
        'Attached washroom',
        'WiFi included',
        'Daily housekeeping',
        'Power backup',
        'RO drinking water',
      ],
    }
  ];

  return (
    <div className="min-h-screen bg-background antialiased selection:bg-indigo-100 selection:text-indigo-900 pb-20">
      {/* Hero Section */}
      <section className="px-4 py-20 md:py-32 max-w-7xl mx-auto flex flex-col items-center text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-sm font-medium mb-4">
          <ShieldCheck className="w-4 h-4" />
          <span>Verified Merchant</span>
        </div>
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-foreground max-w-3xl">
          Affordable and transparent <span className="text-indigo-600">hostel pricing.</span>
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl">
          Choose a room plan that fits your lifestyle and budget. All payments are accepted securely through UPI and Razorpay.
        </p>
      </section>

      {/* Pricing Grid */}
      <section className="px-4 pb-24 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
          {plans.map((plan, i) => (
            <div 
              key={i} 
              className={`relative flex flex-col p-8 rounded-3xl transition-transform duration-300 hover:-translate-y-1 ${
                plan.popular 
                  ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-200/50 ring-2 ring-indigo-600' 
                  : 'bg-card text-card-foreground border border-border shadow-sm'
              }`}
            >
              {plan.popular && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-1.5 bg-amber-500 text-amber-950 text-xs font-bold uppercase tracking-wider rounded-full shadow-sm">
                  Most Popular
                </div>
              )}
              <div className="mb-6 space-y-2">
                <h3 className={`text-2xl font-bold ${plan.popular ? 'text-white' : 'text-foreground'}`}>{plan.title}</h3>
                <p className={`text-sm ${plan.popular ? 'text-indigo-100' : 'text-muted-foreground'}`}>{plan.desc}</p>
              </div>
              <div className="mb-6 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold tracking-tight">₹{plan.price}</span>
                <span className={`text-sm font-medium ${plan.popular ? 'text-indigo-200' : 'text-muted-foreground'}`}>/month</span>
              </div>
              <div className={`p-4 rounded-xl mb-8 flex items-center justify-between text-sm font-medium ${plan.popular ? 'bg-indigo-700/50' : 'bg-muted/50'}`}>
                <span>Security Deposit</span>
                <span>₹{plan.deposit}</span>
              </div>
              <ul className="space-y-4 mb-8 flex-1">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-sm">
                    <Check className={`w-5 h-5 shrink-0 ${plan.popular ? 'text-indigo-300' : 'text-indigo-600'}`} />
                    <span className={plan.popular ? 'text-indigo-50' : 'text-muted-foreground'}>{feature}</span>
                  </li>
                ))}
              </ul>
              <button 
                className={`w-full py-3.5 px-4 rounded-xl text-sm font-bold transition-all active:scale-[0.98] flex justify-center items-center gap-2 ${
                  plan.popular 
                    ? 'bg-white text-indigo-600 hover:bg-indigo-50 shadow-md' 
                    : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                }`}
              >
                Select Plan
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Compliance Notice */}
      <section className="px-4 pb-24 max-w-4xl mx-auto">
        <div className="bg-amber-50/80 border border-amber-200/60 rounded-3xl p-8 md:p-10 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none text-amber-900">
            <ShieldCheck className="w-48 h-48" />
          </div>
          <div className="relative z-10">
            <h2 className="text-2xl font-bold text-amber-950 mb-4 flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-amber-600" />
              Important Payment Policy
            </h2>
            <ul className="space-y-3 text-amber-900/80">
              <li className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 shrink-0" />
                <p>All hostel rent payments must be made <strong>only through the official Stayo web portal</strong>.</p>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 shrink-0" />
                <p><strong>Direct personal UPI transfers are not accepted.</strong> We will not be responsible for payments sent directly to phone numbers.</p>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 shrink-0" />
                <p>Digital receipts are automatically generated and emailed to you for all successful payments.</p>
              </li>
              <li className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-2 shrink-0" />
                <p>Razorpay secure payment gateway is used exclusively for processing all online transactions.</p>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="px-4 pb-20 max-w-3xl mx-auto text-center">
        <h2 className="text-3xl font-bold text-foreground mb-6">Have questions before booking?</h2>
        <p className="text-muted-foreground mb-10 max-w-xl mx-auto">
          Contact our hostel administration team directly. We're here to help you choose the best plan.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
          <div className="flex items-center gap-3 px-6 py-3 bg-card border border-border shadow-sm rounded-xl">
            <Phone className="w-5 h-5 text-indigo-600" />
            <span className="font-medium text-foreground">+91 80080 46952</span>
          </div>
          <div className="flex items-center gap-3 px-6 py-3 bg-card border border-border shadow-sm rounded-xl">
            <Mail className="w-5 h-5 text-indigo-600" />
            <span className="font-medium text-foreground">support@yourstayo.com</span>
          </div>
        </div>
        <button className="px-8 py-4 bg-foreground text-background font-bold rounded-xl shadow-lg hover:bg-foreground/90 transition-all active:scale-[0.98]">
          Book Your Stay Now
        </button>
      </section>
    </div>
  );
}
