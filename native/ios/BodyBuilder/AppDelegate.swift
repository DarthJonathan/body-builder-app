import UIKit
import WebKit
import SafariServices

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = TrainingViewController()
        self.window = window; window.makeKeyAndVisible()
        return true
    }
}

final class TrainingViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var web: WKWebView!
    private let health = HealthReader()
    private var reading = false
    private let message = UILabel()
    private var appURL: URL? {
        guard let configured = Bundle.main.object(forInfoDictionaryKey: "BodyBuilderServerURL") as? String,
              let url = URL(string: configured), url.scheme == "https", let host = url.host,
              !host.hasSuffix("example.com"), url.user == nil, url.password == nil else { return nil }
        return url
    }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 16/255, green: 22/255, blue: 29/255, alpha: 1)
        let config = WKWebViewConfiguration()
        config.limitsNavigationsToAppBoundDomains = true
        config.userContentController.add(self, name: "bodyBuilderHealth")
        let bridge = """
        (() => {
          const pending = new Map();
          window.BodyBuilderHealth = { readEnergy: () => new Promise((resolve, reject) => {
            const id = crypto.randomUUID();
            const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Apple Health timed out. Try again.')); }, 60000);
            pending.set(id, { resolve, reject, timeout });
            window.webkit.messageHandlers.bodyBuilderHealth.postMessage({id});
          }) };
          window.__bodyBuilderHealthComplete = packet => {
            const call = pending.get(packet.id); if (!call) return;
            pending.delete(packet.id); clearTimeout(call.timeout);
            packet.error ? call.reject(new Error(packet.error)) : call.resolve(packet.result);
          };
        })();
        """
        config.userContentController.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self; web.uiDelegate = self
        web.isOpaque = false; web.backgroundColor = view.backgroundColor
        web.scrollView.backgroundColor = view.backgroundColor
        web.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(web)
        NSLayoutConstraint.activate([web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), web.leadingAnchor.constraint(equalTo: view.leadingAnchor), web.trailingAnchor.constraint(equalTo: view.trailingAnchor), web.bottomAnchor.constraint(equalTo: view.bottomAnchor)])
        message.textColor = .white; message.font = .systemFont(ofSize: 17); message.textAlignment = .center
        message.numberOfLines = 0; message.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(message)
        NSLayoutConstraint.activate([message.centerYAnchor.constraint(equalTo: view.centerYAnchor), message.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28), message.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28)])
        guard let url = appURL else {
            message.text = "Set BODYBUILDER_SERVER_URL in Config.xcconfig to your deployed HTTPS app, then rebuild."
            return
        }
        message.text = "Opening BodyBuilder…"; web.load(URLRequest(url: url))
    }
    private func trusted(_ url: URL?) -> Bool {
        guard let url, let base = appURL else { return false }
        return url.scheme == base.scheme && url.host == base.host && (url.port ?? 443) == (base.port ?? 443)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, trusted(message.frameInfo.request.url), trusted(web.url),
              let body = message.body as? [String: Any], let id = body["id"] as? String, UUID(uuidString: id) != nil else { return }
        guard !reading else { reply(id: id, result: .failure(NSError(domain: "BodyBuilder", code: 1, userInfo: [NSLocalizedDescriptionKey: "An Apple Health read is already in progress."]))); return }
        reading = true
        health.read { result in DispatchQueue.main.async { self.reading = false; self.reply(id: id, result: result) } }
    }
    private func reply(id: String, result: Result<[String: Any], Error>) {
        guard trusted(web.url) else { return }
        var packet: [String: Any] = ["id": id]
        switch result { case .success(let value): packet["result"] = value; case .failure(let error): packet["error"] = error.localizedDescription }
        guard let data = try? JSONSerialization.data(withJSONObject: packet), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.__bodyBuilderHealthComplete(\(json));")
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if trusted(url) { decisionHandler(.allow); return }
        decisionHandler(.cancel)
        if navigationAction.navigationType == .linkActivated && ["https", "http"].contains(url.scheme ?? "") { present(SFSafariViewController(url: url), animated: true) }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["https", "http"].contains(url.scheme ?? "") { present(SFSafariViewController(url: url), animated: true) }
        return nil
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { message.text = nil }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        message.text = "Could not open BodyBuilder. Check your connection and reopen the app."
    }
}
