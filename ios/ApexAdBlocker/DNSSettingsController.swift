import Foundation
import NetworkExtension
import Combine

@MainActor final class DNSSettingsController: ObservableObject {
    @Published private(set) var enabled=false
    @Published private(set) var configured=false
    @Published var errorMessage:String?
    private let manager=NEDNSSettingsManager.shared()
    private let dohURL:URL
    init(){let value=Bundle.main.object(forInfoDictionaryKey:"APEX_DOH_URL") as? String; dohURL=URL(string:value ?? "https://apex-studio-production.up.railway.app/api/network/adblock/doh")!; Task{await refresh()}}
    func refresh() async {do{try await load()}catch{errorMessage=error.localizedDescription}}
    func install(){errorMessage=nil;manager.loadFromPreferences{[weak self] error in guard let self else{return};if let error{self.publish(error);return};let settings=NEDNSOverHTTPSSettings(servers:[]);settings.serverURL=self.dohURL;settings.matchDomains=["*"];self.manager.localizedDescription="Apex Studio Ad Blocker";self.manager.dnsSettings=settings;self.manager.saveToPreferences{error in if let error{self.publish(error);return};DispatchQueue.main.async{self.configured=true;self.enabled=self.manager.isEnabled}}}}
    func remove(){errorMessage=nil;manager.removeFromPreferences{[weak self] error in DispatchQueue.main.async{if let error{self?.publish(error);return};self?.configured=false;self?.enabled=false}}}
    private func load() async throws {try await withCheckedThrowingContinuation{c in manager.loadFromPreferences{[weak self] error in if let error{c.resume(throwing:error);return};self?.configured=self?.manager.dnsSettings != nil;self?.enabled=self?.manager.isEnabled == true;c.resume()}}}
    private func publish(_ error:Error){DispatchQueue.main.async{self.errorMessage=error.localizedDescription}}
}
