import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="min-h-screen flex flex-col safe-top safe-bottom">
      <header className="px-6 py-5 md:px-10 md:py-6">
        <div className="flex items-center justify-between max-w-5xl mx-auto">
          <div className="font-bold text-xl text-yopey-primaryDark">YOPEY</div>
          <nav className="flex items-center gap-4 text-sm">
            <a
              href="https://www.yopeybefriender.org"
              target="_blank"
              rel="noreferrer"
              className="text-gray-600 hover:text-yopey-primary"
            >
              About
            </a>
          </nav>
        </div>
      </header>

      <section className="flex-1 px-6 md:px-10 flex items-center">
        <div className="max-w-5xl mx-auto w-full grid md:grid-cols-2 gap-10 md:gap-16 items-center">
          <div>
            <p className="text-yopey-primary font-semibold text-sm tracking-wide uppercase mb-3">
              Befriender Programme · Ages 16+
            </p>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-tight text-yopey-ink">
              Brighten someone&apos;s day —{" "}
              <span className="text-yopey-primary">find a care home</span> near
              you.
            </h1>
            <p className="mt-5 text-lg text-gray-600 leading-relaxed">
              YOPEY pairs young people with elderly care home residents for
              conversation and companionship. Our friendly chatbot helps you
              find a local care home, write your introduction email, and
              supports you every step of the way.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link
                href="/onboard"
                className="inline-flex items-center justify-center px-6 py-4 rounded-2xl bg-yopey-primary text-white font-semibold shadow-lg shadow-purple-200 hover:bg-yopey-primaryDark transition active:scale-[0.98] min-h-[52px]"
              >
                Find a care home →
              </Link>
              <a
                href="https://www.yopeybefriender.org"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center px-6 py-4 rounded-2xl border-2 border-gray-200 text-gray-700 font-semibold hover:border-yopey-primary hover:text-yopey-primary transition min-h-[52px]"
              >
                Learn about YOPEY
              </a>
            </div>

            <p className="mt-6 text-sm text-gray-500">
              Free · UK only · Takes about 5 minutes to get started
            </p>
          </div>

          <div className="md:block">
            <div className="bg-white rounded-3xl shadow-xl p-6 md:p-8 border border-purple-100">
              <div className="space-y-3 text-sm">
                <div className="flex justify-end">
                  <div className="bg-yopey-primary text-white rounded-2xl rounded-tr-md px-4 py-2.5 max-w-[80%]">
                    Hi! My postcode is CB8 8YN
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-800 rounded-2xl rounded-tl-md px-4 py-2.5 max-w-[90%]">
                    Found 5 care homes near you:
                    <div className="mt-1.5 space-y-0.5 text-[13px]">
                      <div>1. The Martins — 0.2 mi · Good</div>
                      <div>2. Glastonbury Court — 0.6 mi · Good</div>
                      <div>3. Mount Farm House — 1.1 mi · Outstanding</div>
                      <div>4. Southgate Beck — 1.4 mi · Good</div>
                      <div>5. Ashlar House — 1.8 mi · Good</div>
                    </div>
                    <div className="mt-1.5">
                      Want me to draft an email for one, a few, or all of them?
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <div className="bg-yopey-primary text-white rounded-2xl rounded-tr-md px-4 py-2.5 max-w-[80%]">
                    Just the first one for now
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-800 rounded-2xl rounded-tl-md px-4 py-2.5 max-w-[80%]">
                    Brilliant! Here&apos;s a draft addressed to the manager at
                    The Martins...
                  </div>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-3 gap-3 text-center text-xs">
                <div className="rounded-xl bg-purple-50 p-3">
                  <div className="font-bold text-yopey-primary">1.</div>
                  <div className="text-gray-700 mt-1">Quick form</div>
                </div>
                <div className="rounded-xl bg-purple-50 p-3">
                  <div className="font-bold text-yopey-primary">2.</div>
                  <div className="text-gray-700 mt-1">Chat & search</div>
                </div>
                <div className="rounded-xl bg-purple-50 p-3">
                  <div className="font-bold text-yopey-primary">3.</div>
                  <div className="text-gray-700 mt-1">Email a home</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="px-6 py-5 md:px-10 md:py-8 text-center text-sm text-gray-500">
        <div>Registered charity 1145573 · hello@yopey.org · 01440 821654</div>
        <div className="mt-2">
          <Link href="/privacy" className="text-yopey-primary hover:underline">
            Privacy & your data
          </Link>
        </div>
      </footer>
    </main>
  );
}
