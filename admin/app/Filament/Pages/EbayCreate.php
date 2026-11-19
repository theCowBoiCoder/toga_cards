<?php

namespace App\Filament\Pages;

use App\Services\InventoryClient;
use Filament\Forms\Components\FileUpload;
use Filament\Forms\Components\Repeater;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Concerns\InteractsWithForms;
use Filament\Forms\Contracts\HasForms;
use Filament\Notifications\Notification;
use Filament\Pages\Page;
use Filament\Schemas\Schema;
use Illuminate\Validation\ValidationException;
use Livewire\Attributes\Locked;

class EbayCreate extends Page implements HasForms
{
    use InteractsWithForms;

    protected static ?string $title = 'Create eBay listing';
    protected static ?string $slug = 'create-ebay-listing';

    protected static bool $shouldRegisterNavigation = false;

    protected string $view = 'filament.pages.ebay-create';

    public ?array $data = [];

    #[Locked]
    public ?array $publication = null;

    public bool $confirmed = false;

    public static function canAccess(): bool
    {
        return auth()->user()?->is_admin === true && auth()->user()?->account_type === 'staff';
    }

    protected function client(): InventoryClient
    {
        return app(InventoryClient::class);
    }

    public function context(): array
    {
        return $this->client()->get('/api/admin/ebay-create');
    }

    public function mount(): void
    {
        $this->form->fill();
        if (request()->filled('draft')) {
            $this->loadDraft((string) request('draft'));
        } elseif (request()->filled('card')) {
            $this->fillCard((int) request('card'));
        }
    }

    public function fillCard(int $cardId): void
    {
        $product = collect($this->context()['products'])->firstWhere('id', $cardId);
        if (! $product) {
            return;
        }
        $this->form->fill([...$product['defaults'], 'cardId' => $cardId, 'sku' => $product['sku'],
            'templateId' => $this->data['templateId'] ?? null, 'image' => [], 'location' => '', 'postalCode' => '']);
    }

    public function form(Schema $schema): Schema
    {
        return $schema->components([
            Select::make('cardId')->label('Website single')->required()->searchable()->live()
                ->options(fn (): array => collect($this->context()['products'])->mapWithKeys(fn (array $card): array => [$card['id'] => $card['sku'].' · '.$card['player'].' #'.$card['number'].' · '.$card['variant']])->all())
                ->afterStateUpdated(fn ($state) => $this->fillCard((int) $state)),
            TextInput::make('sku')->label('Same SKU as the website')->disabled()->dehydrated(false),
            Select::make('templateId')->label('Use selling policies from this existing eBay listing')->required()->searchable()
                ->options(fn (): array => collect($this->context()['templates'])->mapWithKeys(fn (array $item): array => [$item['id'] => $item['title'].' · '.$item['id']])->all())
                ->helperText('Uses its payment, delivery, returns and dispatch location. Card details and photos are not copied. Import eBay listings first if needed.'),
            TextInput::make('title')->label('eBay title')->required()->maxLength(80),
            TextInput::make('price')->label('eBay price per single')->prefix('£')->numeric()->minValue(0.50)->maxValue(10000)->step(0.01)->required(),
            TextInput::make('quantity')->label('Copies to offer')->integer()->minValue(1)->required()
                ->helperText('Checked against current website availability and physical stock again before publication.'),
            Select::make('condition')->label('Ungraded card condition')->required()->options([
                '400010' => 'Near Mint or Better', '400011' => 'Excellent', '400012' => 'Very Good', '400013' => 'Poor',
            ]),
            Textarea::make('description')->label('Description (plain text)')->required()->maxLength(5000)->rows(5),
            Textarea::make('photos')->label('Existing HTTPS card photo URLs, one per line')->maxLength(24000)->rows(3),
            FileUpload::make('image')->label('Or upload additional real card photos')->image()->multiple()->maxFiles(12)->maxParallelUploads(1)
                ->acceptedFileTypes(['image/jpeg', 'image/png', 'image/webp'])->maxSize(5120)
                ->disk('public')->directory('cards')->visibility('public'),
            TextInput::make('location')->label('Dispatch town/city override')->maxLength(80)->helperText('Leave blank to use the template location.'),
            TextInput::make('postalCode')->label('Dispatch postcode override')->maxLength(20)->helperText('Use this if eBay returns a masked template postcode.'),
            Repeater::make('specifics')->label('Item specifics')->schema([
                TextInput::make('name')->required()->maxLength(65), TextInput::make('value')->required()->maxLength(65),
            ])->columns(2)->minItems(1)->maxItems(30)->defaultItems(0),
        ])->statePath('data');
    }

    private function requestAction(array $parameters): void
    {
        try {
            $this->publication = $this->client()->mutate('/api/admin/ebay-create', $parameters)->json();
            $this->confirmed = false;
            if (($parameters['action'] ?? '') === 'load') {
                $preview = $this->publication['preview'];
                $input = $preview['input'];
                $this->form->fill([...$input, 'cardId' => $this->publication['cardId'] ?? null,
                    'price' => $input['price'] / 100, 'templateId' => $preview['templateId'],
                    'photos' => implode("\n", $input['photos']), 'image' => [],
                    'location' => $preview['template']['location'], 'postalCode' => $preview['template']['postalCode']]);
            }
            if ($this->publication['status'] === 'published') {
                Notification::make()->title('eBay listing confirmed and matched to this card')->success()->send();
            }
        } catch (ValidationException $exception) {
            Notification::make()->title('Listing action not confirmed')->body(implode(' ', $exception->errors()['service'] ?? ['Check the fields and try again.']))->danger()->persistent()->send();
        }
    }

    public function previewListing(): void
    {
        $this->client()->authorize();
        $state = $this->form->getState();
        $photos = preg_split('/\r?\n/', $state['photos'] ?? '', flags: PREG_SPLIT_NO_EMPTY);
        foreach ($state['image'] ?? [] as $path) {
            if (is_string($path) && preg_match('~^cards/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$~i', $path)) {
                $photos[] = rtrim(config('app.url'), '/').'/storage/'.$path;
            }
        }
        unset($state['image']);
        $this->requestAction([...$state, 'action' => 'preview', 'price' => (int) round((float) $state['price'] * 100),
            'specifics' => array_values($state['specifics'] ?? []),
            'photos' => implode("\n", array_unique($photos))]);
    }

    public function publishListing(): void
    {
        $this->validate(['confirmed' => 'accepted']);
        abort_unless($this->publication && $this->publication['status'] === 'preview', 409);
        $this->requestAction(['action' => 'publish', 'draftId' => $this->publication['draftId'], 'confirmed' => true]);
    }

    public function checkPublication(string $id): void
    {
        $this->requestAction(['action' => 'check', 'draftId' => $id]);
    }

    public function loadDraft(string $id): void
    {
        $this->requestAction(['action' => 'load', 'draftId' => $id]);
    }

    public function editDetails(): void
    {
        if (($this->publication['status'] ?? '') === 'published') {
            $this->form->fill();
        }
        $this->publication = null;
        $this->confirmed = false;
    }
}
