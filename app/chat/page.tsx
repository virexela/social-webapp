"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { MessageSquare, Lock, Info } from "lucide-react";
import { getCrypto } from "@/lib/crypto";
import { useSocialStore } from "@/lib/state/store";
import { DebugConnections } from "./DebugConnections";
import { DiagonalPattern, Navigation, Card, Container } from "@/components";

export default function ChatPage() {
  const selectedChatId = useSocialStore((s) => s.selectedChatId);

  useEffect(() => {
    void getCrypto();
  }, []);

  return (
    <>
      <DiagonalPattern />
      <Navigation />
      
      <main className="min-h-screen pt-16">
        <section className="py-12 sm:py-20">
          <Container size="md">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="mb-12 text-center"
            >
              <div className="inline-flex items-center justify-center w-16 h-16 bg-black text-white mb-6">
                <MessageSquare size={32} />
              </div>
              <h1 className="text-4xl sm:text-5xl font-medium tracking-tight mb-4">
                Secure Messaging
              </h1>
              <p className="text-lg text-gray-600 max-w-2xl mx-auto">
                End-to-end encrypted conversations with zero-knowledge architecture
              </p>
            </motion.div>

            {/* Status Card */}
            <Card className="mb-8">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 bg-black text-white flex items-center justify-center">
                  <Lock size={24} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-xl font-medium mb-2">Current Session</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600">Selected Chat:</span>
                      <span className="font-mono bg-gray-100 px-2 py-1 border border-gray-200">
                        {selectedChatId ?? "(none)"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Info Card */}
            <Card className="mb-8 bg-gray-50 border-gray-300">
              <div className="flex items-start gap-3">
                <Info size={20} className="text-gray-700 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium mb-2">Cryptographic Pipeline</h4>
                  <p className="text-sm text-gray-600">
                    Message encrypt/decrypt flows are routed through the WASM bridge.
                    All cryptographic operations run in Rust for maximum security and performance.
                  </p>
                </div>
              </div>
            </Card>

            {/* Chat Interface Placeholder */}
            <Card hover={false} className="mb-8">
              <div className="text-center py-12">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 text-gray-400 mb-4">
                  <MessageSquare size={32} />
                </div>
                <h3 className="text-xl font-medium mb-2">Chat Interface</h3>
                <p className="text-gray-600 max-w-md mx-auto">
                  Full chat UI with message composition, history, and real-time updates
                  will be implemented here.
                </p>
              </div>
            </Card>

            {/* Debug Connections */}
            <DebugConnections />
          </Container>
        </section>
      </main>
    </>
  );
}
