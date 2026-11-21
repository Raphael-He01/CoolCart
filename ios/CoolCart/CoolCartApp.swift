import SwiftUI

@main
struct CoolCartApp: App {
    @UIApplicationDelegateAdaptor(CartAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            CartScreen()
                .background(Color(uiColor: CartViewController.backgroundColor).ignoresSafeArea())
        }
    }
}

private final class CartAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     willFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        CartReminderCenter.shared.installDelegate()
        return true
    }
}

private struct CartScreen: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> CartViewController {
        CartViewController()
    }

    func updateUIViewController(_ controller: CartViewController, context: Context) {}
}
