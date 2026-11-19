<?php

namespace Tests\Feature;

use App\Filament\Pages\EbayCreate;
use App\Models\User;
use Filament\Facades\Filament;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Livewire\Livewire;
use Tests\TestCase;

class EbayCreateTest extends TestCase
{
    use RefreshDatabase;

    private function publicationResult(string $status = 'preview'): array
    {
        return ['draftId' => str_repeat('A', 32), 'cardId' => 1, 'status' => $status,
            'itemId' => $status === 'published' ? '223456789012' : null,
            'url' => $status === 'published' ? 'https://www.ebay.co.uk/itm/223456789012' : null,
            'expiresAt' => now()->addMinutes(15)->toIso8601String(), 'issue' => '',
            'preview' => ['input' => [
                'title' => 'Test Player #24', 'sku' => 'TC-S-000001', 'price' => 249, 'quantity' => 2,
                'condition' => '400010', 'photos' => ['https://shop.example/card.jpg'],
                'description' => 'One ungraded card.', 'specifics' => [['name' => 'Graded', 'value' => 'No']],
            ], 'templateId' => '123456789012', 'templateTitle' => 'Existing selling policies',
                'template' => ['location' => 'Test town', 'postalCode' => 'TE1 1ST', 'dispatchDays' => 2, 'autoPay' => true,
                    'policies' => ['payment' => ['id' => '11', 'name' => 'Managed payments'],
                        'shipping' => ['id' => '22', 'name' => 'Royal Mail'], 'returns' => ['id' => '33', 'name' => '30-day returns']],
                    'services' => [['name' => 'Royal Mail 2nd Class', 'cost' => 155, 'additional' => 0, 'free' => false]],
                    'returns' => ['accepted' => 'ReturnsAccepted', 'within' => 'Days_30', 'payer' => 'Buyer']],
                'verification' => ['fees' => [['name' => 'InsertionFee', 'pence' => 0, 'currency' => 'GBP']], 'warnings' => []]],
        ];
    }

    private function prepare(): void
    {
        $this->actingAs(User::factory()->create(['is_admin' => true, 'account_type' => 'staff']));
        Filament::setCurrentPanel(Filament::getPanel('admin'));
        Http::preventStrayRequests();
        Http::fake(['http://127.0.0.1:3001/api/admin/ebay-create' => function (Request $request) {
            if ($request->method() === 'GET') {
                return Http::response(['connected' => true, 'drafts' => [],
                    'templates' => [['id' => '123456789012', 'title' => 'Existing selling policies']],
                    'products' => [['id' => 1, 'sku' => 'TC-S-000001', 'player' => 'Test Player', 'number' => '24', 'variant' => 'Base', 'available' => 4,
                        'defaults' => ['title' => 'Test Player #24', 'price' => 1.99, 'quantity' => 1,
                            'photos' => 'https://shop.example/card.jpg', 'description' => 'One ungraded card.', 'condition' => '400010',
                            'specifics' => [['name' => 'Graded', 'value' => 'No']]]]]]);
            }
            return Http::response($this->publicationResult(in_array($request['action'], ['publish', 'check'], true) ? 'published' : 'preview'));
        }]);
    }

    public function test_staff_can_prepare_and_preview_without_publishing_then_explicitly_confirm(): void
    {
        $this->prepare();
        $page = Livewire::test(EbayCreate::class)->call('fillCard', 1)
            ->assertSet('data.sku', 'TC-S-000001')
            ->fillForm(['templateId' => '123456789012', 'price' => 2.49, 'quantity' => 2])
            ->call('previewListing')->assertHasNoFormErrors()
            ->assertSee('Review the eBay listing preview')->assertSee('TC-S-000001')->assertSee('Royal Mail');
        Http::assertSent(fn (Request $request): bool => $request->method() === 'POST' && $request['action'] === 'preview'
            && $request['price'] === 249 && $request['cardId'] === 1 && array_is_list($request['specifics']));
        Http::assertNotSent(fn (Request $request): bool => $request->method() === 'POST' && $request['action'] === 'publish');
        $page->call('publishListing')->assertHasErrors('confirmed');
        Http::assertNotSent(fn (Request $request): bool => $request->method() === 'POST' && $request['action'] === 'publish');
        $page->set('confirmed', true)->call('publishListing')->assertHasNoErrors()->assertSee('View eBay listing 223456789012');
        Http::assertSent(fn (Request $request): bool => $request->method() === 'POST' && $request['action'] === 'publish'
            && $request['draftId'] === str_repeat('A', 32) && $request['confirmed'] === true);
        $this->assertDatabaseHas('audit_events', ['operation' => '/api/admin/ebay-create:publish', 'outcome' => 'succeeded']);
    }

    public function test_submitted_preview_is_locked_against_client_price_tampering(): void
    {
        $this->prepare();
        $page = Livewire::test(EbayCreate::class)->call('loadDraft', str_repeat('A', 32));
        $this->expectException(\Livewire\Features\SupportLockedProperties\CannotUpdateLockedPropertyException::class);
        $page->set('publication.preview.input.price', 1);
    }

    public function test_customer_and_guest_accounts_cannot_open_the_publisher(): void
    {
        $this->get('/admin/create-ebay-listing')->assertRedirect('/admin/login');
        $this->actingAs(User::factory()->create(['is_admin' => false, 'account_type' => 'customer']));
        $this->get('/admin/create-ebay-listing')->assertForbidden();
    }

    public function test_checked_publication_does_not_send_another_publish_action(): void
    {
        $this->prepare();
        Livewire::test(EbayCreate::class)->call('checkPublication', str_repeat('A', 32))->assertSee('Listing confirmed');
        Http::assertSent(fn (Request $request): bool => $request->method() === 'POST' && $request['action'] === 'check');
        Http::assertNotSent(fn (Request $request): bool => $request->method() === 'POST' && $request['action'] === 'publish');
    }
}
