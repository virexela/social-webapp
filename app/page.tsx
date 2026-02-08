"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Lock, Zap, Shield, MessageSquare } from "lucide-react";
import { DiagonalPattern, Logo, Navigation, Button, Card, Container } from "@/components";

export default function Home() {
  const features = [
    {
      icon: Lock,
      title: "End-to-End Encrypted",
      description: "Military-grade encryption running entirely in Rust/WASM for maximum security.",
    },
    {
      icon: Zap,
      title: "Zero Latency",
      description: "Lightning-fast performance with optimized cryptographic operations.",
    },
    {
      icon: Shield,
      title: "Privacy First",
      description: "Your data stays yours. No tracking, no analytics, no compromises.",
    },
    {
      icon: MessageSquare,
      title: "Seamless Communication",
      description: "Beautiful, intuitive interface designed for effortless secure messaging.",
    },
  ];

  return (
    <>
      <DiagonalPattern />
      <Navigation />
      
      <main className="min-h-screen pt-16">
        {/* Hero Section */}
        <section className="relative py-20 sm:py-32">
          <Container>
            <div className="flex flex-col items-center text-center">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="mb-8"
              >
                <Logo size={120} animated={true} />
              </motion.div>

              <motion.h1
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="text-5xl sm:text-6xl lg:text-7xl font-medium tracking-tight mb-6 max-w-4xl"
              >
                Secure Communication.
                <br />
                <span className="text-gray-600">Swiss Design.</span>
              </motion.h1>

              <motion.p
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="text-lg sm:text-xl text-gray-600 mb-12 max-w-2xl"
              >
                End-to-end encrypted messaging platform with cryptographic operations
                running entirely in Rust/WASM. Privacy meets performance.
              </motion.p>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.4 }}
                className="flex flex-col sm:flex-row gap-4"
              >
                <Link href="/login">
                  <Button size="lg" className="group">
                    Get Started
                    <ArrowRight
                      size={20}
                      className="transition-transform group-hover:translate-x-1"
                    />
                  </Button>
                </Link>
                <Link href="/chat">
                  <Button variant="secondary" size="lg">
                    View Demo
                  </Button>
                </Link>
              </motion.div>
            </div>
          </Container>

          {/* Decorative Lines */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.6 }}
            className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-black to-transparent"
          />
        </section>

        {/* Features Section */}
        <section className="py-20 sm:py-32 bg-gray-50">
          <Container>
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center mb-16"
            >
              <h2 className="text-3xl sm:text-4xl font-medium tracking-tight mb-4">
                Built for Security
              </h2>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                Every feature designed with privacy and performance in mind
              </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
              {features.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <motion.div
                    key={feature.title}
                    initial={{ y: 40, opacity: 0 }}
                    whileInView={{ y: 0, opacity: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                  >
                    <Card>
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 w-12 h-12 bg-black text-white flex items-center justify-center">
                          <Icon size={24} />
                        </div>
                        <div>
                          <h3 className="text-xl font-medium mb-2">{feature.title}</h3>
                          <p className="text-gray-600">{feature.description}</p>
                        </div>
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          </Container>
        </section>

        {/* Architecture Section */}
        <section className="py-20 sm:py-32">
          <Container size="md">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <Card hover={false} className="bg-black text-white border-black">
                <div className="text-center py-8">
                  <h2 className="text-3xl sm:text-4xl font-medium tracking-tight mb-6">
                    Rust/WASM Architecture
                  </h2>
                  <p className="text-gray-300 text-lg mb-8 max-w-2xl mx-auto">
                    JavaScript hosts the UI only. All cryptographic operations run in
                    compiled Rust via WebAssembly for maximum security and performance.
                  </p>
                  <div className="flex flex-wrap justify-center gap-6 text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-white rounded-full" />
                      <span>Zero-copy data passing</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-white rounded-full" />
                      <span>Memory-safe operations</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-white rounded-full" />
                      <span>Native performance</span>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          </Container>
        </section>

        {/* CTA Section */}
        <section className="py-20 sm:py-32 bg-gray-50">
          <Container size="md">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
              className="text-center"
            >
              <h2 className="text-3xl sm:text-4xl font-medium tracking-tight mb-6">
                Ready to get started?
              </h2>
              <p className="text-lg text-gray-600 mb-8 max-w-xl mx-auto">
                Experience secure communication with Swiss design precision
              </p>
              <Link href="/login">
                <Button size="lg" className="group">
                  Launch Application
                  <ArrowRight
                    size={20}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </Button>
              </Link>
            </motion.div>
          </Container>
        </section>

        {/* Footer */}
        <footer className="border-t border-gray-200 py-12">
          <Container>
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-2">
                <Logo size={24} animated={false} />
                <span className="font-medium">SOCIAL</span>
              </div>
              <p className="text-sm text-gray-600">
                © 2026 SOCIAL. All rights reserved.
              </p>
            </div>
          </Container>
        </footer>
      </main>
    </>
  );
}

